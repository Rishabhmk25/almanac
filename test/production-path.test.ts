import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cfg } from '../src/config.js';
import { getDb } from '../src/db/migrate.js';
import { runAgent, AgentCtx, stripAndFlagCitations, groundCitations } from '../src/agent/loop.js';
import { EvidenceItem } from '../src/memory/store.js';
import * as geminiModule from '../src/llm/gemini.js';
import * as searchModule from '../src/tools/search.js';

describe('Production Path Smoke & Record/Replay Test', () => {
  const origFeaturesSearch = cfg.features.search;
  const origFeaturesLlm = cfg.features.llm;
  const origTavily = cfg.tavilyKey;
  const origGemini = cfg.geminiKey;

  beforeEach(() => {
    getDb(':memory:');
    vi.restoreAllMocks();
    // Stub hermetic test configuration so tests pass without environment API keys
    cfg.features.search = true;
    cfg.features.llm = true;
    cfg.tavilyKey = 'test-tavily-key';
    cfg.geminiKey = 'test-gemini-key';
  });

  afterEach(() => {
    cfg.features.search = origFeaturesSearch;
    cfg.features.llm = origFeaturesLlm;
    cfg.tavilyKey = origTavily;
    cfg.geminiKey = origGemini;
  });

  it('verifies strip-and-flag citation handling on production output', () => {
    const mockEvidence: EvidenceItem[] = [
      {
        ref: 'M1',
        kind: 'memory',
        title: 'CRM discussion',
        snippet: 'We discussed HubSpot and Pipedrive.',
      },
      {
        ref: 'W1',
        kind: 'web',
        title: 'HubSpot Pricing',
        entity: 'HubSpot',
        url: 'https://hubspot.com/pricing',
        domain: 'hubspot.com',
        snippet: 'HubSpot Starter is $20 per seat per month.',
      },
    ];

    // Text containing valid citations [M1], [W1], and a phantom hallucinated citation [W99]
    const rawAnswer = 'From our earlier discussion [M1], HubSpot Starter is $20 [W1], but Enterprise is $500 [W99].';

    const result = stripAndFlagCitations(rawAnswer, mockEvidence);

    // [W99] must be stripped from the text
    expect(result.text).not.toContain('[W99]');
    expect(result.text).toContain('[M1]');
    expect(result.text).toContain('[W1]');

    // [W99] must be recorded as a flag
    expect(result.flags.length).toBeGreaterThanOrEqual(1);
    const phantomFlag = result.flags.find(f => f.reason.includes('does not exist') && f.sourceRef === 'W99');
    expect(phantomFlag).toBeDefined();

    // groundCitations backward compatibility wrapper
    expect(groundCitations(rawAnswer, mockEvidence)).toBe(result.text);
  });

  it('executes production path turn flow with auto search call and replay responses', async () => {
    const emittedEvents: Array<{ event: string; data: unknown }> = [];
    const emit = (event: string, data: unknown) => {
      emittedEvents.push({ event, data });
    };

    const mockMemoryItems: EvidenceItem[] = [
      {
        ref: 'M1',
        kind: 'memory',
        title: 'Monday CRM Shortlist',
        snippet: 'On Monday we shortlisted HubSpot ($20/mo) and Pipedrive ($14/mo).',
      },
    ];

    // Replay sequence:
    // Round 1: Model autonomously decides to call web_search (tool_choice: 'auto')
    // Round 2: Model receives search results and generates grounded final answer
    const streamRoundSpy = vi.spyOn(geminiModule, 'streamRound');

    streamRoundSpy.mockImplementationOnce(async (opts) => {
      // Assert tool_choice is 'auto' in production path
      expect(opts.tool_choice).toBe('auto');

      return {
        content: '',
        toolCalls: [
          {
            id: 'call_search_1',
            type: 'function',
            function: {
              name: 'web_search',
              arguments: JSON.stringify({
                queries: [
                  { q: 'HubSpot pricing changes', entity: 'HubSpot', kind: 'current' },
                  { q: 'Pipedrive pricing changes', entity: 'Pipedrive', kind: 'current' },
                ],
              }),
            },
          },
        ],
      };
    });

    // Mock search batch execution returning verified snippets
    vi.spyOn(searchModule, 'runBatch').mockResolvedValueOnce([
      {
        query: { q: 'HubSpot pricing changes', entity: 'HubSpot', kind: 'current', depth: 'basic', read: false, topic: 'general' },
        results: [
          {
            title: 'HubSpot Pricing 2026',
            url: 'https://hubspot.com/pricing',
            content: 'HubSpot Starter remains $20 per seat per month.',
            published: '2026-11-10',
          },
        ],
        ms: 120,
      },
      {
        query: { q: 'Pipedrive pricing changes', entity: 'Pipedrive', kind: 'current', depth: 'basic', read: false, topic: 'general' },
        results: [
          {
            title: 'Pipedrive Plans',
            url: 'https://pipedrive.com/pricing',
            content: 'Pipedrive Essential is $14 per user monthly.',
            published: '2026-11-10',
          },
        ],
        ms: 110,
      },
    ]);

    // Round 2 answer generation replay: cites [M1], [W1], [W2]
    streamRoundSpy.mockImplementationOnce(async () => {
      return {
        content: 'From our earlier notes [M1], HubSpot Starter was $20/mo and Pipedrive was $14/mo. Current sources show HubSpot Starter is $20 [W1] and Pipedrive Essential is $14 [W2]. Pricing matches our earlier notes.',
        toolCalls: [],
      };
    });

    const ctx: AgentCtx = {
      conversationId: 'smoke-test-conv',
      userText: 'On Monday we shortlisted HubSpot and Pipedrive. Has any pricing changed since?',
      contextBlock: 'Saved note: [M1] CRM shortlist (Mon 9 Nov 2026)',
      memoryItems: mockMemoryItems,
      history: [],
      tz: 'UTC',
    };

    const ctrl = new AbortController();
    const result = await runAgent(ctx, emit, ctrl.signal);

    // 1. Verify text produced
    expect(result.text).toContain('HubSpot');
    expect(result.text).toContain('Pipedrive');
    expect(result.text).toContain('[M1]');
    expect(result.text).toContain('[W1]');
    expect(result.text).toContain('[W2]');

    // 2. Verify evidence store tracked both memory and web items
    expect(result.evidence.some(e => e.kind === 'memory')).toBe(true);
    expect(result.evidence.some(e => e.kind === 'web')).toBe(true);
    expect(result.evidence.length).toBe(3); // M1, W1, W2

    // 3. Verify zero verifier errors because numbers literally match snippets
    const criticalFlags = result.flags.filter(f => /unsupported|not in the cited source|does not exist/i.test(f.reason));
    expect(criticalFlags).toHaveLength(0);

    // 4. Verify turn stages in trace
    expect(result.trace.some(t => t.stage === 'search')).toBe(true);
    expect(result.trace.some(t => t.stage === 'write')).toBe(true);
    expect(result.trace.some(t => t.stage === 'verify')).toBe(true);

    // 5. Verify events emitted
    expect(emittedEvents.some(e => e.event === 'evidence')).toBe(true);
    expect(emittedEvents.some(e => e.event === 'status')).toBe(true);
  });

  it('autonomously bypasses search for greetings in production path', async () => {
    const streamRoundSpy = vi.spyOn(geminiModule, 'streamRound');

    // Model receives greeting with tool_choice: 'auto' and answers directly without tool calls
    streamRoundSpy.mockImplementationOnce(async (opts) => {
      expect(opts.tool_choice).toBe('auto');
      return {
        content: 'Hello! How can I help you today?',
        toolCalls: [],
      };
    });

    const ctx: AgentCtx = {
      conversationId: 'greeting-test-conv',
      userText: 'Hello there!',
      contextBlock: 'No relevant notes found.',
      memoryItems: [],
      history: [],
      tz: 'UTC',
    };

    const ctrl = new AbortController();
    const result = await runAgent(ctx, () => {}, ctrl.signal);

    expect(result.text).toBe('Hello! How can I help you today?');
    expect(result.budget.queries).toBe(0);
    expect(result.trace.find(t => t.stage === 'search')?.note).toBe('auto-bypassed');
  });
});
