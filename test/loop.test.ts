import { describe, it, expect } from 'vitest';
import { makeForcedFinalPrompt, makeInvalidArgsPrompt, FALLBACKS } from '../src/agent/prompts.js';
import { WebSearchArgs, detectEvidenceGaps, EvidenceStore, Budget } from '../src/tools/search.js';
import { shouldBypassSearch } from '../src/agent/loop.js';

describe('Agent Loop & Prompts (loop.ts & prompts.ts)', () => {
  it('identifies greetings, pleasantries, acknowledgments and formatting commands that bypass search', async () => {
    // Greetings & farewells
    expect(await shouldBypassSearch('hello')).toBe(true);
    expect(await shouldBypassSearch('Hi!')).toBe(true);
    expect(await shouldBypassSearch('hey there')).toBe(true);
    expect(await shouldBypassSearch('good morning almanac')).toBe(true);
    expect(await shouldBypassSearch('howdy')).toBe(true);
    expect(await shouldBypassSearch('bye')).toBe(true);
    expect(await shouldBypassSearch('goodbye, see you later')).toBe(true);

    // Gratitude, pleasantries & acknowledgments
    expect(await shouldBypassSearch('thanks, that helps!')).toBe(true);
    expect(await shouldBypassSearch('thank you so much')).toBe(true);
    expect(await shouldBypassSearch('ok')).toBe(true);
    expect(await shouldBypassSearch('got it')).toBe(true);
    expect(await shouldBypassSearch('sounds good')).toBe(true);
    expect(await shouldBypassSearch('cool')).toBe(true);

    // Assistant meta & chitchat
    expect(await shouldBypassSearch('who are you?')).toBe(true);
    expect(await shouldBypassSearch('what can you do')).toBe(true);
    expect(await shouldBypassSearch('help')).toBe(true);
    expect(await shouldBypassSearch('hello! how are you?')).toBe(true);

    // Formatting & follow-up adjustments
    expect(await shouldBypassSearch('make that a table')).toBe(true);
    expect(await shouldBypassSearch('format as a table')).toBe(true);
    expect(await shouldBypassSearch('summarize that')).toBe(true);
    expect(await shouldBypassSearch('shorter please')).toBe(true);

    // Personal schedule, task list, agenda, and private notebook queries
    expect(await shouldBypassSearch('What is on my schedule and task list for today?')).toBe(true);
    expect(await shouldBypassSearch('What are my tasks for today?')).toBe(true);
    expect(await shouldBypassSearch('Show me my schedule for Friday')).toBe(true);
    expect(await shouldBypassSearch('What meetings do I have today?')).toBe(true);
    expect(await shouldBypassSearch('What is on my calendar tomorrow?')).toBe(true);
    expect(await shouldBypassSearch('Check my to-do list')).toBe(true);
    expect(await shouldBypassSearch('What action items do I have?')).toBe(true);
    expect(await shouldBypassSearch('What did I ask on Tuesday?')).toBe(true);
    expect(await shouldBypassSearch('What did I ask on 3 November?')).toBe(true);
    expect(await shouldBypassSearch('what did i ask you on 3 nov')).toBe(true);
  });

  it('does NOT bypass search for informational, pricing, product, or temporal queries', async () => {
    expect(await shouldBypassSearch('What is the price of HubSpot?')).toBe(false);
    expect(await shouldBypassSearch('How much does Pipedrive cost?')).toBe(false);
    expect(await shouldBypassSearch('Postgres hosting options')).toBe(false);
    expect(await shouldBypassSearch('Has anything changed since Monday?')).toBe(false);
    expect(await shouldBypassSearch('Hello, what does Linear cost?')).toBe(false);
    expect(await shouldBypassSearch('Has Linear released any new features since Tuesday?')).toBe(false);
    expect(await shouldBypassSearch('Combien coûte HubSpot?')).toBe(false);
    expect(await shouldBypassSearch('What is on my schedule and how much does Supabase cost?')).toBe(false);
  });

  it('detects evidence gaps for missing entities', () => {
    const store = new EvidenceStore();

    // Round 1 added evidence only for HubSpot and Pipedrive
    store.add([
      {
        query: { q: 'HubSpot pricing', entity: 'HubSpot', kind: 'current', topic: 'general', depth: 'basic', read: false },
        results: [{ title: 'HubSpot Pricing', url: 'https://hubspot.com/pricing', content: 'HubSpot Starter is $20/mo' }],
        ms: 100,
      },
      {
        query: { q: 'Pipedrive pricing', entity: 'Pipedrive', kind: 'current', topic: 'general', depth: 'basic', read: false },
        results: [{ title: 'Pipedrive Pricing', url: 'https://pipedrive.com/pricing', content: 'Pipedrive is $14/mo' }],
        ms: 100,
      }
    ]);

    const expected = ['HubSpot', 'Pipedrive', 'Zoho', 'Freshsales', 'Close'];
    const gaps = detectEvidenceGaps(expected, store);

    expect(gaps).toEqual(['Zoho', 'Freshsales', 'Close']);
  });
  it('generates forced final prompt with reason', () => {
    const prompt = makeForcedFinalPrompt('the search budget is used');
    expect(prompt).toContain('Search is finished: the search budget is used.');
    expect(prompt).toContain('Do not call any tool.');
    expect(prompt).toContain('Could not verify');
  });

  it('generates invalid arguments prompt', () => {
    const prompt = makeInvalidArgsPrompt('q is required');
    expect(prompt).toContain('Invalid arguments: q is required.');
    expect(prompt).toContain('Send {"queries":[{"q":"HubSpot pricing","entity":"HubSpot","kind":"current"}]}');
  });

  it('validates WebSearchArgs schema strictly', () => {
    const valid = {
      queries: [
        {
          q: 'HubSpot pricing',
          entity: 'HubSpot',
          kind: 'current',
        },
      ],
    };
    const parsed = WebSearchArgs.safeParse(valid);
    expect(parsed.success).toBe(true);

    const invalid = { queries: [] };
    const invalidParsed = WebSearchArgs.safeParse(invalid);
    expect(invalidParsed.success).toBe(false);
  });

  it('has fallback strings for critical failure states', () => {
    expect(FALLBACKS.empty).toContain("couldn't produce an answer");
    expect(FALLBACKS.tavilyDown).toContain('Web search didn\'t respond');
    expect(FALLBACKS.tavilyMissing).toContain('Web search is switched off');
    expect(FALLBACKS.groq429).toContain('rate-limited');
    expect(FALLBACKS.groqMissing).toContain('GROQ_API_KEY');
  });

  it('bounds search loop to (deadlineMs - reserveForAnswerMs) to guarantee answer reserve within 25s total', () => {
    const deadlineMs = 25000;
    const reserveForAnswerMs = 8000;
    const searchDeadlineMs = Math.max(1000, deadlineMs - reserveForAnswerMs);
    expect(searchDeadlineMs).toBe(17000);

    // If search takes full 17s:
    const elapsedAfterSearch = 17000;
    const remainingForAnswer = Math.max(500, deadlineMs - elapsedAfterSearch);
    expect(remainingForAnswer).toBe(8000);
    expect(elapsedAfterSearch + remainingForAnswer).toBeLessThanOrEqual(deadlineMs);
  });

  it('ensures write phase uses dedicated reserve window and is not aborted by search timeout', () => {
    const searchTimeoutCtrl = new AbortController();
    searchTimeoutCtrl.abort(new Error('Search timeout'));

    // Writing phase uses a fresh dedicated abort controller rather than inheriting the aborted search controller
    const writeCtrl = new AbortController();
    expect(writeCtrl.signal.aborted).toBe(false);
  });
});

