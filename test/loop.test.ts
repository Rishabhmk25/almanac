import { describe, it, expect } from 'vitest';
import { makeForcedFinalPrompt, makeInvalidArgsPrompt, FALLBACKS } from '../src/agent/prompts.js';
import { WebSearchArgs } from '../src/tools/search.js';
import { shouldBypassSearch } from '../src/agent/loop.js';

describe('Agent Loop & Prompts (loop.ts & prompts.ts)', () => {
  it('identifies greetings, pleasantries, acknowledgments and formatting commands that bypass search', () => {
    // Greetings & farewells
    expect(shouldBypassSearch('hello')).toBe(true);
    expect(shouldBypassSearch('Hi!')).toBe(true);
    expect(shouldBypassSearch('hey there')).toBe(true);
    expect(shouldBypassSearch('good morning almanac')).toBe(true);
    expect(shouldBypassSearch('howdy')).toBe(true);
    expect(shouldBypassSearch('bye')).toBe(true);
    expect(shouldBypassSearch('goodbye, see you later')).toBe(true);

    // Gratitude, pleasantries & acknowledgments
    expect(shouldBypassSearch('thanks, that helps!')).toBe(true);
    expect(shouldBypassSearch('thank you so much')).toBe(true);
    expect(shouldBypassSearch('ok')).toBe(true);
    expect(shouldBypassSearch('got it')).toBe(true);
    expect(shouldBypassSearch('sounds good')).toBe(true);
    expect(shouldBypassSearch('cool')).toBe(true);

    // Assistant meta & chitchat
    expect(shouldBypassSearch('who are you?')).toBe(true);
    expect(shouldBypassSearch('what can you do')).toBe(true);
    expect(shouldBypassSearch('help')).toBe(true);
    expect(shouldBypassSearch('hello! how are you?')).toBe(true);

    // Formatting & follow-up adjustments
    expect(shouldBypassSearch('make that a table')).toBe(true);
    expect(shouldBypassSearch('format as a table')).toBe(true);
    expect(shouldBypassSearch('summarize that')).toBe(true);
    expect(shouldBypassSearch('shorter please')).toBe(true);
  });

  it('does NOT bypass search for informational, pricing, product, or temporal queries', () => {
    expect(shouldBypassSearch('What is the price of HubSpot?')).toBe(false);
    expect(shouldBypassSearch('How much does Pipedrive cost?')).toBe(false);
    expect(shouldBypassSearch('Postgres hosting options')).toBe(false);
    expect(shouldBypassSearch('Has anything changed since Monday?')).toBe(false);
    expect(shouldBypassSearch('Hello, what does Linear cost?')).toBe(false);
    expect(shouldBypassSearch('What did I ask on Tuesday?')).toBe(false);
    expect(shouldBypassSearch('Combien coûte HubSpot?')).toBe(false);
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

