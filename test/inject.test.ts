import { describe, it, expect, beforeEach } from 'vitest';
import { ftsQuery, addMessage, getOrCreateConversation } from '../src/memory/store.js';
import { buildMemoryContext, sanitizeTags, estTokens } from '../src/memory/inject.js';
import { getDb } from '../src/db/migrate.js';
import { TemporalHint } from '../src/agent/time.js';

describe('Memory Injection (inject.ts & store.ts)', () => {
  beforeEach(() => {
    // Reset test database in memory
    getDb(':memory:');
  });

  it('ftsQuery quotes tokens, strips punctuation, drops stopwords', () => {
    const q = ftsQuery('What was the HubSpot pricing on 2026-11-09?');
    expect(q).toBeDefined();
    expect(q).toContain('"hubspot"');
    expect(q).toContain('"pricing"');
    // stopwords 'what', 'was', 'the', 'on' should not be present
    expect(q).not.toContain('"what"');
    expect(q).not.toContain('"the"');
  });

  it('sanitizeTags rewrites [W1], [M2], [U3] to (W1), (M2), (U3)', () => {
    const original = 'HubSpot is $20 [W1] and we noted [M2] with flag [U1]';
    const sanitized = sanitizeTags(original);
    expect(sanitized).toBe('HubSpot is $20 (W1) and we noted (M2) with flag (U1)');
    expect(sanitized).not.toContain('[W1]');
  });

  it('pleasantries get empty memory block without notes', () => {
    const res = buildMemoryContext('hello', [], null);
    expect(res.memoryItems).toHaveLength(0);
    expect(res.contextBlock).not.toContain('NOTES FROM EARLIER CHATS');
  });

  it('list mode activates when content tokens <= 3 and date window is present', () => {
    const conv = getOrCreateConversation(null, 'UTC', 'Test chat');
    const t0 = Date.now() - 100_000;
    // Add messages in the window
    addMessage(conv.id, 'user', 'Question 1 about CRM', { createdAt: t0 });
    addMessage(conv.id, 'user', 'Question 2 about Postgres', { createdAt: t0 + 1000 });

    const hint: TemporalHint = {
      phrase: 'on 3 November',
      from: t0 - 10_000,
      to: t0 + 20_000,
      label: 'Tue 3 Nov 2026',
    };

    const res = buildMemoryContext('what did I ask on 3 November?', [hint], conv.id, []);
    expect(res.contextBlock).toContain('Showing');
    expect(res.contextBlock).toContain('user messages on Tue 3 Nov 2026');
    expect(res.memoryItems.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps ambiguous Thursday readings as two separate date windows', () => {
    const conv = getOrCreateConversation(null, 'UTC', 'Thursday chats');
    const thisThursday = Date.UTC(2026, 10, 12);
    const lastThursday = Date.UTC(2026, 10, 5);
    addMessage(conv.id, 'user', 'Question from this Thursday', { createdAt: thisThursday + 3600_000 });
    addMessage(conv.id, 'assistant', 'Answer from this Thursday', { createdAt: thisThursday + 7200_000 });
    addMessage(conv.id, 'user', 'Unrelated question from Sunday', { createdAt: Date.UTC(2026, 10, 8) });
    addMessage(conv.id, 'assistant', 'Answer from Sunday', { createdAt: Date.UTC(2026, 10, 8) + 3600_000 });
    addMessage(conv.id, 'user', 'Question from last Thursday', { createdAt: lastThursday + 3600_000 });
    addMessage(conv.id, 'assistant', 'Answer from last Thursday', { createdAt: lastThursday + 7200_000 });

    const hint: TemporalHint = {
      phrase: 'Thursday',
      from: thisThursday,
      to: Date.UTC(2026, 10, 13),
      label: 'Thu 12 Nov 2026',
      alt: {
        phrase: 'Thursday',
        from: lastThursday,
        to: Date.UTC(2026, 10, 6),
        label: 'Thu 5 Nov 2026',
      },
    };

    const res = buildMemoryContext('What did I ask on Thursday?', [hint], conv.id);
    expect(res.contextBlock).toContain('Question from this Thursday');
    expect(res.contextBlock).toContain('Question from last Thursday');
    expect(res.contextBlock).not.toContain('Unrelated question from Sunday');
  });
});

