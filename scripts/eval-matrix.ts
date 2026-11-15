import { resolveDateHints } from '../src/agent/time.js';
import { now } from '../src/clock.js';

interface MatrixCase {
  query: string;
  tz: string;
  expectedMinHints: number;
  expectedMatch: string;
  description: string;
}

export async function runMatrixEval(): Promise<void> {
  console.log('=== Almanac Temporal Date & Timezone Matrix Evaluation ===\n');

  // Freeze baseline to Tuesday 17 Nov 2026 14:00 UTC for deterministic cross-environment matrix testing
  const fixedNow = new Date('2026-11-17T14:00:00Z').getTime();

  const testMatrix: MatrixCase[] = [
    {
      query: 'What did I ask on 3 November?',
      tz: 'UTC',
      expectedMinHints: 1,
      expectedMatch: '3 Nov',
      description: 'Standard day + month name',
    },
    {
      query: 'What did I ask on Nov 3rd?',
      tz: 'America/New_York',
      expectedMinHints: 1,
      expectedMatch: '3 Nov',
      description: 'Month prefix with ordinal suffix in US timezone',
    },
    {
      query: 'What did we discuss yesterday?',
      tz: 'UTC',
      expectedMinHints: 1,
      expectedMatch: '16 Nov',
      description: 'Relative "yesterday" anchored to frozen now (17 Nov -> 16 Nov)',
    },
    {
      query: 'What did I ask on Tuesday?',
      tz: 'UTC',
      expectedMinHints: 1,
      expectedMatch: '17 Nov',
      description: 'Bare weekday matching current day (provides disambiguation)',
    },
    {
      query: 'What did I ask on Friday?',
      tz: 'Asia/Kolkata',
      expectedMinHints: 1,
      expectedMatch: 'Nov',
      description: 'Past weekday in Indian Standard Time (IST)',
    },
    {
      query: 'Compare what I asked on 3 November with Monday',
      tz: 'Europe/London',
      expectedMinHints: 2,
      expectedMatch: '3 Nov',
      description: 'Compound multi-date query (detects two distinct temporal hints)',
    },
    {
      query: 'What notes do we have from earlier today?',
      tz: 'Pacific/Auckland',
      expectedMinHints: 1,
      expectedMatch: 'Nov',
      description: 'Intra-day bounds ("earlier today") in NZ timezone',
    },
    {
      query: 'Check tasks from two weeks ago',
      tz: 'UTC',
      expectedMinHints: 1,
      expectedMatch: 'Nov',
      description: 'Multi-week offset calculation',
    },
  ];

  console.log('| # | Query | Timezone | Expected Match | Status |');
  console.log('|---|---|---|---|:---:|');

  let passed = 0;
  for (let i = 0; i < testMatrix.length; i++) {
    const tc = testMatrix[i];
    const hints = resolveDateHints(tc.query, fixedNow, tc.tz);
    const hasEnoughHints = hints.length >= tc.expectedMinHints;
    const matchesLabel = hints.some(h => h.label.includes(tc.expectedMatch) || (h.alt && h.alt.label.includes(tc.expectedMatch)));
    const ok = hasEnoughHints && matchesLabel;
    if (ok) passed++;
    console.log(`| ${i + 1} | "${tc.query}" | ${tc.tz} | ${tc.expectedMatch} | ${ok ? 'PASS ✅' : 'FAIL ❌'} |`);
  }

  console.log(`\nTemporal Matrix Score: ${passed}/${testMatrix.length} (${Math.round((passed / testMatrix.length) * 100)}%)`);
  if (passed === testMatrix.length) {
    console.log('✅ Temporal Date Resolution across timezones verified.\n');
  } else {
    process.exit(1);
  }
}

// CLI entry point
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Almanac Temporal & Timezone Matrix Evaluation Runner

Usage:
  npm run eval:temporal

Validates:
  - Exact and relative date parsing across UTC, US, UK, IST, NZST
  - Multi-date compound queries ("3 Nov and Monday")
  - Same-day weekday disambiguation
  - Intra-day ("earlier today") boundaries
`);
  process.exit(0);
}

runMatrixEval().catch(err => {
  console.error('Matrix Eval Error:', err);
  process.exit(1);
});
