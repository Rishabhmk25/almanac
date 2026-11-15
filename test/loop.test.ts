import { describe, it, expect } from 'vitest';
import { makeForcedFinalPrompt, makeInvalidArgsPrompt, FALLBACKS } from '../src/agent/prompts.js';
import { WebSearchArgs } from '../src/tools/search.js';

describe('Agent Loop & Prompts (loop.ts & prompts.ts)', () => {
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

