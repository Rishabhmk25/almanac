# Almanac Evaluation & Verification Report

**Evaluated At**: 2026-11-15T14:59:08Z  
**Application**: Almanac (Research, Archive & Intelligence Assistant)  
**Evaluation Scope**: Unit Tests, Component Invariants, End-to-End Evaluation, Temporal Matrix, Adversarial Robustness, and Rate-Limit Stress Testing  

---

## 1. Executive Summary

| Quality Gate | Command | Scope | Pass Rate | Status |
|---|---|---|:---:|:---:|
| **TypeScript Compiler** | `npm run typecheck` | Strict compiler checks across codebase | 100% (0 errors) | PASS ✅ |
| **Vitest Unit Suite** | `npm test` | Testing FTS5, date parser, verifier, search batching | 41 / 41 (100%) | PASS ✅ |
| **Component Invariants** | `npm run eval` | 23 concrete assertion cases &times; 3 runs | 69 / 69 (100%) | PASS ✅ |
| **End-to-End Scenarios** | `npm run eval:e2e` | Complete chat flow (3 core + 5 hard cases) | 8 / 8 (100%) | PASS ✅ |
| **Adversarial Robustness** | `npm run eval:adversarial` | Prompt injection, SQL injection, citation forgery, XSS | 6 / 6 (100%) | PASS ✅ |
| **Temporal Matrix** | `npm run eval:temporal` | Date parsing across UTC, US, UK, IST, NZST timezones | 8 / 8 (100%) | PASS ✅ |
| **Concurrency Stress** | `npm run eval:stress` | Groq 30 RPM throttler compliance & budget caps | PASS (Serialized) | PASS ✅ |

> [!NOTE]
> All evaluation data, execution timestamps, and per-case outputs are persisted on disk in [`scorecard.json`](./scorecard.json) and [`scorecard-e2e.json`](./scorecard-e2e.json), and summarized in [`README.md`](./README.md) and [`DESIGN.md`](./DESIGN.md).

---

## 2. End-to-End Evaluation (`npm run eval:e2e`)

The E2E evaluation verifies the complete agentic pipeline: question ingestion, date resolution, SQLite FTS5 memory recall, vendor-first search planning, evidence gathering, structured claims drafting, and claim-level verification.

### Score Breakdown by Dimension

* **Turn Recall**: **100%** (accurately locates historical conversation records or cleanly detects absence)
* **Correctness & Structure**: **100%** (preserves plan, currency, billing period distinctions; avoids monthly vs. annual confusions)
* **Supporting Citations**: **100%** (grounded with valid `[M#]` notes and `[W#]` web citations)
* **Honesty & Verification**: **100%** (abstains with "could not verify" on missing/failed searches; verifier flags undated evidence)
* **Overall E2E Score**: **100%** (8 / 8 cases passed)

### Per-Scenario Results Matrix

| # | Test Scenario | Category | Turn Recall | Correctness | Citations | Honesty & Verif | Status |
|---|---|---|:---:|:---:|:---:|:---:|:---:|
| **1** | **Sample 1: Date-anchored recall (3 November)**<br>_“What did I ask on 3 Nov? Is your answer still correct today?”_ | Core Question | 100% | 100% | 100% | 100% | PASS ✅ |
| **2** | **Sample 2: Pricing comparison & structured claims**<br>_“Has any CRM tool shortlisted Monday changed pricing since?”_ | Core Question | 100% | 100% | 100% | 100% | PASS ✅ |
| **3** | **Sample 3: Vendor-first search synthesis**<br>_“Compare Postgres managed DB pricing between Supabase and Neon”_ | Core Question | 100% | 100% | 100% | 100% | PASS ✅ |
| **4** | **Hard Case 1: Missing history**<br>_“What did we agree on with the ACME vendor on 12 August?”_ | Hard Case | 100% | 100% | 100% | 100% | PASS ✅ |
| **5** | **Hard Case 2: Ambiguous dates (two readings)**<br>_“What did I ask on Friday?”_ | Hard Case | 100% | 100% | 100% | 100% | PASS ✅ |
| **6** | **Hard Case 3: Failed searches**<br>_“What is the current pricing of Linear as of today?”_ | Hard Case | 100% | 100% | 100% | 100% | PASS ✅ |
| **7** | **Hard Case 4: Conflicting sources**<br>_“What is the pricing for Tool X?”_ | Hard Case | 100% | 100% | 100% | 100% | PASS ✅ |
| **8** | **Hard Case 5: Stale and undated pages**<br>_“Did Product Y change price?”_ | Hard Case | 100% | 100% | 100% | 100% | PASS ✅ |

---

## 3. Component Invariant Evaluation (`npm run eval`)

Repeats 23 deterministic component assertions three times across SQLite FTS5 search, date parser, quota limits, and verifier traps: **69/69 (100%)** passed.

| # | Test Invariant | Category | Runs Passed | Result |
|---|---|---|:---:|:---:|
| 1 | CRM tools shortlisted Monday | Recall | 3 / 3 | 100% |
| 2 | 3 November recall in list mode | Recall | 3 / 3 | 100% |
| 3 | Last Tuesday Postgres hosting | Recall | 3 / 3 | 100% |
| 4 | Empty history recall abstention | Recall | 3 / 3 | 100% |
| 5 | Bare weekday equal to today (two readings) | Recall | 3 / 3 | 100% |
| 6 | "Earlier today" bounds window to now | Recall | 3 / 3 | 100% |
| 7 | Follow-up query ("make that a table") bypasses memory | Recall | 3 / 3 | 100% |
| 8 | Topic switch inside one chat isolates memory | Recall | 3 / 3 | 100% |
| 9 | Prompt injection defense in system prompt | Security | 3 / 3 | 100% |
| 10 | Stored assistant answers labelled as derived claims | Security | 3 / 3 | 100% |
| 11 | Invented-price trap (verifier flags uncited figure) | Verifier | 3 / 3 | 100% |
| 12 | Wrong-entity attribution trap ($20 from tool A cited for tool B) | Verifier | 3 / 3 | 100% |
| 13 | Ordinary-word entity ("Close") avoids false attribution | Verifier | 3 / 3 | 100% |
| 14 | Five entities evidence cap quota allocation | Budget | 3 / 3 | 100% |
| 15 | Undated pricing page format caveat | Formatting | 3 / 3 | 100% |
| 16 | `FAULT=tavily_down` triggers isolated search fallback | Fault | 3 / 3 | 100% |
| 17 | Evidence character budget enforces `maxEvidenceChars` | Budget | 3 / 3 | 100% |
| 18 | `FAULT=query_timeout` isolates single failed query | Fault | 3 / 3 | 100% |
| 19 | "thanks, that helps" pleasantry fast path | Recall | 3 / 3 | 100% |
| 20 | Multi-lingual query preservation | Formatting | 3 / 3 | 100% |
| 21 | Paraphrase recall: "database provider" matches Postgres | Recall | 3 / 3 | 100% |
| 22 | Paraphrase recall: "sales software shortlist" matches CRM tools | Recall | 3 / 3 | 100% |
| 23 | Busy day (50 messages): list mode truncation message | Recall | 3 / 3 | 100% |

---

## 4. Adversarial Security & Robustness (`npm run eval:adversarial`)

Evaluates resistance against injection attacks, malicious formatting payloads, and citation spoofing: **6/6 (100%)** passed.

| # | Test Scenario | Threat Category | Result |
|---|---|---|:---:|
| 1 | Memory Prompt Injection (System Override Attempt) | Prompt Injection | PASS ✅ |
| 2 | SQL Injection & FTS5 Query Escapes | SQL Injection | PASS ✅ |
| 3 | Citation Forgery & Spoofed Tag Detection (`[W99]`) | Integrity | PASS ✅ |
| 4 | HTML / Script Tag Sanitization | XSS / Script Injection | PASS ✅ |
| 5 | System Secret & API Key Exfiltration Defense | Secret Leakage | PASS ✅ |
| 6 | Massive Query Buffer Overflow Resistance | Resource Exhaustion | PASS ✅ |

---

## 5. Temporal Date & Timezone Matrix (`npm run eval:temporal`)

Validates chronological date anchor resolution across international timezones: **8/8 (100%)** passed.

| # | Query | Timezone | Expected Resolution | Status |
|---|---|---|---|:---:|
| 1 | "What did I ask on 3 November?" | UTC | 3 Nov | PASS ✅ |
| 2 | "What did I ask on Nov 3rd?" | America/New_York | 3 Nov | PASS ✅ |
| 3 | "What did we discuss yesterday?" | UTC | 16 Nov (relative) | PASS ✅ |
| 4 | "What did I ask on Tuesday?" | UTC | 17 Nov (two readings) | PASS ✅ |
| 5 | "What did I ask on Friday?" | Asia/Kolkata (IST) | Nov | PASS ✅ |
| 6 | "Compare what I asked on 3 November with Monday" | Europe/London | 3 Nov + Monday | PASS ✅ |
| 7 | "What notes do we have from earlier today?" | Pacific/Auckland | Intra-day bounds | PASS ✅ |
| 8 | "Check tasks from two weeks ago" | UTC | Multi-week offset | PASS ✅ |

---

## 6. Concurrency & Rate Limit Stress (`npm run eval:stress`)

Validates strict compliance with Groq's 30 RPM rate limit:
* **Request Serialization Queue**: 4 concurrent bursts serialized with average interval of **2,208ms** (exceeding minimum requirement of 2,200ms, capping calls at &le; 27 RPM).
* **Zero HTTP 429 Errors**: No rate limit exceptions observed during parallel execution.
* **Evidence Budget Protection**: When bombarded with 50 bulky web search results, the evidence store strictly respects the 10,000 character maximum budget.

---

## 7. Granular CLI Testing Options

Both test runners support vast CLI options for fine-grained debugging:

```bash
# Run specific cases by ID
npm run eval -- --case=11
npm run eval:e2e -- --case=2 --verbose

# Filter by test category
npm run eval -- --category=verifier
npm run eval:e2e -- --category=hard_case

# Filter by keyword
npm run eval -- --filter="postgres"
npm run eval:e2e -- --filter="pricing"

# Custom repetition count or bail on first failure
npm run eval -- --runs=5 --bail

# Machine-readable JSON output
npm run eval -- --json
npm run eval:e2e -- --json
```

---

## 8. Persisted Repository Files

* **Full Evaluation Report**: [`EVAL_REPORT.md`](./EVAL_REPORT.md)
* **E2E Evaluation Scorecard**: [`scorecard-e2e.json`](./scorecard-e2e.json)
* **Component Invariant Scorecard**: [`scorecard.json`](./scorecard.json)
* **Architecture & Verification Design**: [`DESIGN.md`](./DESIGN.md)
* **Test Instructions & Score Tables**: [`README.md`](./README.md)
