import fs from 'node:fs';
import path from 'node:path';
import { cfg } from '../src/config.js';
import { now } from '../src/clock.js';
import { getDb } from '../src/db/migrate.js';
import { resolveDateHints, startOfLocalDay, addLocalDays, dowIn } from '../src/agent/time.js';
import { buildMemoryContextAsync } from '../src/memory/inject.js';
import { runAgent, AgentResult } from '../src/agent/loop.js';
import { addMessage, getOrCreateConversation, EvidenceItem, storeEmbedding } from '../src/memory/store.js';
import { generateDeterministicEmbedding } from '../src/memory/embeddings.js';

type EvalCheck = { name: string; passed: boolean; detail: string };
type EvalCase = { id: number; name: string; query: string; requiredGroups: string[][] };
type EvalResult = EvalCase & {
  checks: EvalCheck[];
  passed: boolean;
  answer: string;
  evidence: Array<Pick<EvidenceItem, 'ref' | 'kind' | 'title' | 'url' | 'domain' | 'published'>>;
  flags: string[];
  budget: AgentResult['budget'];
};

const timezone = 'UTC';
const cases: EvalCase[] = [
  {
    id: 1,
    name: 'Nov 3 recall and current follow-up',
    query: 'What did I ask you on 3 November? Is your answer still correct today?',
    requiredGroups: [['feedback'], ['canny', 'productboard', 'uservoice']],
  },
  {
    id: 2,
    name: 'Monday CRM shortlist follow-up',
    query: 'On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?',
    requiredGroups: [['hubspot'], ['pipedrive'], ['zoho'], ['freshsales'], ['close']],
  },
  {
    id: 3,
    name: 'Last Tuesday Postgres pricing follow-up',
    query: 'Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?',
    requiredGroups: [['postgres'], ['supabase'], ['neon']],
  },
];

function previousWeekday(targetDow: number, nowMs: number): number {
  const today = startOfLocalDay(nowMs, timezone);
  const diff = (dowIn(nowMs, timezone) - targetDow + 7) % 7 || 7;
  return addLocalDays(today, -diff, timezone) + 10 * 60 * 60 * 1000;
}

function addFixture(title: string, at: number, userText: string, assistantText: string): void {
  const conversation = getOrCreateConversation(null, timezone, title);
  const u = addMessage(conversation.id, 'user', userText, { createdAt: at, imported: 1 });
  const a = addMessage(conversation.id, 'assistant', assistantText, { createdAt: at + 60_000, imported: 1 });
  storeEmbedding(u.id, generateDeterministicEmbedding(userText));
  storeEmbedding(a.id, generateDeterministicEmbedding(assistantText));
}

function seedEvalHistory(): void {
  const current = now();
  const year = new Date(current).getUTCFullYear();
  let nov3 = Date.UTC(year, 10, 3, 10);
  if (nov3 > current) nov3 = Date.UTC(year - 1, 10, 3, 10);

  addFixture(
    'Customer feedback tools',
    nov3,
    'What are good tools for tracking customer feedback?',
    'We discussed Canny, Productboard, and UserVoice for collecting feedback and managing product roadmaps.'
  );
  addFixture(
    'CRM shortlist',
    previousWeekday(1, current),
    'We are shortlisting CRM tools for a 20-person sales team: HubSpot, Pipedrive, Zoho CRM, Freshsales, and Close.',
    'The shortlist is HubSpot, Pipedrive, Zoho CRM, Freshsales, and Close. This note contains no saved baseline prices or release versions.'
  );
  addFixture(
    'Postgres hosting',
    previousWeekday(2, current),
    'What are the main options for managed Postgres hosting?',
    'We compared Supabase and Neon. The notes recorded Supabase Pro at $25/month and Neon Launch at $19/month, but did not preserve the original source pages.'
  );
}

function evaluate(testCase: EvalCase, result: AgentResult): EvalResult {
  const refs = new Map(result.evidence.map(item => [item.ref, item]));
  const citations = [...result.text.matchAll(/\[([WM]\d+)\]/g)].map(match => match[1] ?? '');
  const memoryRefs = result.evidence.filter(item => item.kind === 'memory').map(item => item.ref);
  const webRefs = result.evidence.filter(item => item.kind === 'web').map(item => item.ref);
  const lower = result.text.toLowerCase();
  const missedGroups = testCase.requiredGroups.filter(group => !group.some(term => lower.includes(term)));
  const supportFlags = result.flags.filter(flag => /figure without|not in the cited source|does not mention the product|source that does not exist/i.test(flag.reason));
  const checks: EvalCheck[] = [
    { name: 'Answer produced', passed: result.text.trim().length > 0, detail: `${result.text.trim().length} characters` },
    { name: 'Historical details recalled', passed: missedGroups.length === 0, detail: missedGroups.length ? `Missing: ${missedGroups.map(group => group.join('/')).join(', ')}` : 'All expected terms found' },
    { name: 'Memory citation present', passed: citations.some(ref => memoryRefs.includes(ref)), detail: `${memoryRefs.length} memory item(s), ${citations.filter(ref => memoryRefs.includes(ref)).length} cited` },
    { name: 'Live web evidence cited', passed: webRefs.length > 0 && citations.some(ref => webRefs.includes(ref)), detail: `${webRefs.length} web result(s), ${citations.filter(ref => webRefs.includes(ref)).length} cited` },
    { name: 'Citations resolve to evidence', passed: citations.length > 0 && citations.every(ref => refs.has(ref)), detail: citations.length ? `${citations.length} citation(s)` : 'No citations' },
    { name: 'Verifier found no unsupported figures or source mismatches', passed: supportFlags.length === 0, detail: supportFlags.length ? supportFlags.map(flag => flag.reason).join('; ') : 'No such verifier flags' },
  ];

  return {
    ...testCase,
    checks,
    passed: checks.every(check => check.passed),
    answer: result.text,
    evidence: result.evidence.map(({ ref, kind, title, url, domain, published }) => ({ ref, kind, title, url, domain, published })),
    flags: result.flags.map(flag => flag.reason),
    budget: result.budget,
  };
}

async function main(): Promise<void> {
  if (!cfg.features.llm || !cfg.features.search) {
    throw new Error('E2E evaluation requires an active LLM key (GEMINI_API_KEY or GROQ_API_KEY) and TAVILY_API_KEY in .env. Mock bypasses are not provided.');
  }

  const caseArg = process.argv.find(arg => arg.startsWith('--case='));
  const caseId = caseArg ? Number(caseArg.slice('--case='.length)) : undefined;
  if (caseId !== undefined && !cases.some(item => item.id === caseId)) {
    throw new Error(`Unknown case ${caseId}. Choose 1, 2, or 3.`);
  }

  getDb(':memory:');
  seedEvalHistory();
  const selected = caseId ? cases.filter(item => item.id === caseId) : cases;
  const results: EvalResult[] = [];

  for (let idx = 0; idx < selected.length; idx++) {
    const testCase = selected[idx]!;
    if (idx > 0) {
      console.log('\nPacing rate limits between eval cases (3s cooldown)...');
      await new Promise(r => setTimeout(r, 3000));
    }
    const hints = resolveDateHints(testCase.query, now(), timezone);
    const memory = await buildMemoryContextAsync(testCase.query, hints, null, [], timezone);
    const agentResult = await runAgent({
      conversationId: `eval-${testCase.id}`,
      userText: testCase.query,
      contextBlock: memory.contextBlock,
      memoryItems: memory.memoryItems,
      history: [],
      tz: timezone,
    }, () => {}, new AbortController().signal);

    const scored = evaluate(testCase, agentResult);
    results.push(scored);
    console.log(`${scored.passed ? 'PASS' : 'FAIL'} ${testCase.id}. ${testCase.name}`);
    for (const check of scored.checks) console.log(`  ${check.passed ? '[PASS]' : '[FAIL]'} ${check.name}: ${check.detail}`);
  }

  const checks = results.flatMap(result => result.checks);
  const scorecard = {
    timestamp: new Date().toISOString(),
    mode: 'live' as const,
    model: cfg.model,
    casesRun: results.length,
    passedCases: results.filter(result => result.passed).length,
    passedChecks: checks.filter(check => check.passed).length,
    totalChecks: checks.length,
    cases: results,
  };
  const outPath = path.resolve('scorecard-e2e.json');
  fs.writeFileSync(outPath, JSON.stringify(scorecard, null, 2), 'utf8');
  console.log(`\nLive eval: ${scorecard.passedCases}/${scorecard.casesRun} cases, ${scorecard.passedChecks}/${scorecard.totalChecks} checks.`);
  console.log(`Full answers and retrieved source metadata: ${outPath}`);
  if (scorecard.passedChecks !== scorecard.totalChecks) process.exitCode = 1;
}

main().catch(error => {
  console.error(`E2E evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
