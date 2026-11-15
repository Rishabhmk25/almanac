import { describe, it, expect } from 'vitest';
import {
  resolveDateHints,
  startOfLocalDay,
  addLocalDays,
  fmtLabel,
  localMidnight,
} from '../src/agent/time.js';

describe('Date Resolver (time.ts)', () => {
  // Freeze time to Thursday 12 Nov 2026 10:30:00 UTC
  const frozenNow = Date.parse('2026-11-12T10:30:00Z');
  const tzLA = 'America/Los_Angeles';
  const tzUTC = 'UTC';

  it('resolves bare "Monday" to most recent Monday (9 Nov 2026)', () => {
    const hints = resolveDateHints('what happened on Monday?', frozenNow, tzUTC);
    const mon = hints.find(h => h.phrase.includes('monday'));
    expect(mon).toBeDefined();
    expect(mon?.label).toContain('9 Nov 2026');
  });

  it('resolves "last Tuesday" to 10 Nov with alt 3 Nov', () => {
    const hints = resolveDateHints('did we talk last Tuesday?', frozenNow, tzUTC);
    const tue = hints.find(h => h.phrase.includes('last tuesday') || h.phrase.includes('tuesday'));
    expect(tue).toBeDefined();
    expect(tue?.label).toContain('10 Nov 2026');
    expect(tue?.alt).toBeDefined();
    expect(tue?.alt?.label).toContain('3 Nov 2026');
  });

  it('resolves bare "Thursday" equal to today with two readings (today and 7 days ago)', () => {
    const hints = resolveDateHints('on Thursday we agreed', frozenNow, tzUTC);
    const thu = hints.find(h => h.phrase === 'thursday');
    expect(thu).toBeDefined();
    expect(thu?.label).toContain('12 Nov 2026');
    expect(thu?.alt).toBeDefined();
    expect(thu?.alt?.label).toContain('5 Nov 2026');
  });

  it('resolves "last Thursday" to exactly 7 days ago (5 Nov 2026)', () => {
    const hints = resolveDateHints('last Thursday we agreed', frozenNow, tzUTC);
    const thu = hints.find(h => h.phrase.includes('last thursday'));
    expect(thu).toBeDefined();
    expect(thu?.label).toContain('5 Nov 2026');
    expect(thu?.alt).toBeUndefined();
  });

  it('resolves explicit date "3 November" to 3 Nov 2026', () => {
    const hints = resolveDateHints('what did I ask on 3 November?', frozenNow, tzUTC);
    const nov3 = hints.find(h => h.label.includes('3 Nov 2026'));
    expect(nov3).toBeDefined();
  });

  it('resolves explicit date variations for 3 Nov uniformly', () => {
    const variants = [
      'what did i ask you on 3 nov',
      'What did I ask on 3 November?',
      'what did I ask on 3rd November',
      'what did I ask on Nov 3rd?',
      'what did I ask on November 3',
      'what did I ask on November 3rd?',
    ];
    for (const q of variants) {
      const hints = resolveDateHints(q, frozenNow, tzUTC);
      const nov3 = hints.find(h => h.label.includes('3 Nov 2026'));
      expect(nov3, `Failed to resolve 3 Nov 2026 for: ${q}`).toBeDefined();
    }
  });

  it('resolves explicit future date with no year "20 December" to previous year (20 Dec 2025)', () => {
    const hints = resolveDateHints('notes from 20 December', frozenNow, tzUTC);
    const dec = hints.find(h => h.label.includes('20 Dec'));
    expect(dec).toBeDefined();
    expect(dec?.label).toContain('2025');
  });

  it('resolves "earlier today" to start of today up to now', () => {
    const hints = resolveDateHints('earlier today I asked', frozenNow, tzUTC);
    const todayHint = hints.find(h => h.phrase === 'earlier today');
    expect(todayHint).toBeDefined();
    expect(todayHint?.to).toBe(frozenNow);
    const todayStart = startOfLocalDay(frozenNow, tzUTC);
    expect(todayHint?.from).toBe(todayStart);
  });

  it('resolves "2 hours ago" to window ending at now', () => {
    const hints = resolveDateHints('2 hours ago you told me', frozenNow, tzUTC);
    const hint = hints.find(h => h.phrase.includes('2 hours ago'));
    expect(hint).toBeDefined();
    expect(hint?.to).toBe(frozenNow);
    expect(hint?.from).toBe(frozenNow - 3 * 3600_000);
  });

  it('handles local timezone conversion accurately (America/Los_Angeles)', () => {
    const hints = resolveDateHints('yesterday', frozenNow, tzLA);
    const yest = hints.find(h => h.phrase === 'yesterday');
    expect(yest).toBeDefined();
    const today0LA = startOfLocalDay(frozenNow, tzLA);
    const yest0LA = addLocalDays(today0LA, -1, tzLA);
    expect(yest?.from).toBe(yest0LA);
  });
});

