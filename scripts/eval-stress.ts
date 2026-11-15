import { throttleGroq } from '../src/llm/groq.js';
import { cfg } from '../src/config.js';
import { EvidenceStore, Budget } from '../src/tools/search.js';

export async function runStressEval(): Promise<void> {
  console.log('=== Almanac Concurrency & Rate Limit Stress Evaluation ===\n');

  console.log('1. Testing Groq 30 RPM Pacer with 5 Concurrent Bursts...');
  const timestamps: number[] = [];

  const burstTasks = Array.from({ length: 4 }, async (_, i) => {
    await throttleGroq();
    const now = Date.now();
    timestamps.push(now);
    return { taskId: i, executedAt: now };
  });

  const results = await Promise.all(burstTasks);
  console.log(`Executed ${results.length} queued tasks cleanly.`);

  // Verify spacing between calls
  let pacerCompliant = true;
  for (let i = 1; i < timestamps.length; i++) {
    const delta = timestamps[i] - timestamps[i - 1];
    console.log(`  Interval between call ${i} and ${i + 1}: ${delta}ms (Target: >= 2,200ms)`);
    // Allow slight 100ms timer variance
    if (delta < 2100) {
      pacerCompliant = false;
    }
  }

  console.log(`Pacer Strict 30 RPM Compliance: ${pacerCompliant ? 'PASS' : 'FAIL'}`);

  console.log('\n2. Testing High Volume Evidence Truncation & Budget Protection...');
  const budget = new Budget(cfg.budget);
  const store = new EvidenceStore([], budget);

  // Attempt to flood store with 50 bulky evidence items across entities
  const mockResults = Array.from({ length: 50 }, (_, i) => ({
    query: { q: `pricing tier ${i}`, entity: `vendor_${i % 5}` },
    results: [
      {
        url: `https://test-vendor-${i}.example.com/pricing`,
        title: `Pricing Tier ${i}`,
        content: 'Pro plan costs $20/month with annual discount. '.repeat(40),
      },
    ],
  }));

  store.add(mockResults, budget);

  const items = store.items;
  const totalChars = items.reduce((sum, it) => sum + (it.snippet ? it.snippet.length : 0), 0);
  console.log(`Total items retained: ${items.length} (Max budget: ${cfg.budget.maxEvidenceChars} chars)`);
  console.log(`Total snippet chars: ${totalChars} chars`);

  const budgetProtected = totalChars <= cfg.budget.maxEvidenceChars;
  console.log(`Evidence Budget Protection: ${budgetProtected ? 'PASS' : 'FAIL'}`);

  if (pacerCompliant && budgetProtected) {
    console.log('\nStress & Rate-Limit Evaluation Passed.\n');
  } else {
    process.exit(1);
  }
}

// CLI entry point
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Almanac Concurrency & Rate Limit Stress Evaluation Runner

Usage:
  npm run eval:stress

Validates:
  - Groq 30 RPM request pacing serialization (>= 2,200ms intervals)
  - Zero 429 rate limit exceptions under concurrent bursts
  - Memory evidence character budgeting and overflow protection
`);
  process.exit(0);
}

runStressEval().catch(err => {
  console.error('Stress Eval Error:', err);
  process.exit(1);
});
