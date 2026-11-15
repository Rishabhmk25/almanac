# Almanac

A research and memory chat agent with live web search and dated conversational memory. Ask it what you discussed last Tuesday, whether pricing has changed since Monday, or compare database options with rigorous sourcing.

### Key Capabilities

* **Nomic Semantic Embeddings & Hybrid RRF**: Combines SQLite FTS5 BM25 keyword matching with dense 768-dimensional Nomic Embed v1.5 vectors via Reciprocal Rank Fusion, resolving conceptual paraphrases without manual synonyms.
* **Google Gemini 3.5 Flash Engine**: Fast reasoning with native tool calling and high token throughput, eliminating token starvation and enabling multi-round search gap filling.
* **Automated Gap Detection & Targeted Re-Query**: After search round 1, Almanac programmatically checks which entities lack evidence. Round 2 specifically executes targeted re-queries with full page reads for missing entities, ensuring no shortlisted item is omitted.
* **Lightweight Query Classifier**: Instead of brittle regex blocklists, an LLM classifier categorizes query intent, bypassing web search for greetings, formatting requests, and private personal notebook inquiries (schedule, tasks, calendar).
* **Structured Comparison Claims**: For "Has pricing changed?" queries, Almanac aligns earlier product, plan, price, currency, billing period, and source alongside new evidence. Eliminates false change assertions caused by comparing monthly per-seat pricing to annual plans.
* **Vendor-First Source Quality**: Search plans prioritize official vendor pricing pages and changelogs (`current`, `changelog`) before corroborating with independent news or reviews. Distinguishes verified change announcements from undated pages that merely display a different number.
* **Humble & Useful Verifier**: Transparently flags unsupported figures, missing citations, product mismatches, and undated evidence. Shows which claim and source triggered each warning without pretending a number match proves full semantic truth.
* **Polished Editorial Experience**: Date resolution badges (`📅 Tue 3 Nov 2026`), dynamic suggestions reflecting chat memory and web research, transparent verification limits, accessible `:focus-visible` ink rings, sidebar focus trap, and `Ctrl+K` navigation.

## Install

```bash
nvm use          # Node >= 22
npm install
cp .env.example .env
# Add your GEMINI_API_KEY and TAVILY_API_KEY to .env (NOMIC_API_KEY optional)
```

## Run

```bash
npm run dev      # http://127.0.0.1:3000
```

Try with demo data:

```bash
SEED_DEMO=1 npm run dev
```

Then ask: "What did I ask you on 3 November?" or "Has any of the CRM tools we shortlisted on Monday changed pricing since?"

## Required keys

| Key | Purpose |
|---|---|
| `GEMINI_API_KEY` | Primary LLM calls (Gemini 3.5 Flash) |
| `TAVILY_API_KEY` | Web search and page reading (Tavily) |
| `NOMIC_API_KEY` | (Optional) Nomic Embed API for semantic vector memory |
| `GROQ_API_KEY` | (Optional) Fallback LLM calls |

Gemini and Tavily keys are optional: a missing LLM key shows a setup message; a missing Tavily key means answers use notes only. The UI shows a banner explaining what is off.

## Configuration

See `.env.example` for all environment variables including:
- `MODEL` / `FALLBACK_MODEL` — LLM model IDs (defaults to `gemini-3.5-flash` / `gemini-3.5-flash-lite`)
- `HOST` / `PORT` — Server binding (`127.0.0.1`, `localhost`, or `::1` only; non-loopback hosts are refused)
- Budget settings: `MAX_ROUNDS`, `MAX_QUERIES_PER_TURN`, `MAX_READS`, `DEADLINE_MS`
- Testing: `NOW_OVERRIDE`, `SEED_DEMO`, `FAULT`

## Database reset

To reset all conversations and messages back to zero:

```bash
npm run db:reset
```

## Importing ChatGPT or historical chats

### 1. Import ChatGPT data export
To import your official ChatGPT data export (`conversations.json` from the ChatGPT zip export):

```bash
npm run import:chatgpt path/to/conversations.json
```

This parses the conversation tree, extracts user & assistant turns with original timestamps, and inserts them into Almanac with `imported = 1`.

### 2. HTTP Import API

```bash
# Set ADMIN_TOKEN in .env first
curl -X POST http://127.0.0.1:3000/api/import \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"conversations":[{"title":"My chat","tz":"UTC","messages":[{"role":"user","content":"Hello","createdAt":1730000000000}]}]}'
```

## Demo data (`SEED_DEMO=1`)

Writes three conversations with dates relative to today:
- **CRM shortlist** (this Monday) — five CRM tools discussed
- **Postgres hosting** (last Tuesday) — managed Postgres providers
- **3 November chat** — customer feedback tools

Shown in the UI with a "demo data" label. Default boot is clean (no seed).

## Quality gates & testing suites

```bash
npm run typecheck          # TypeScript strict check (0 errors)
npm test                   # Unit tests (vitest - 53 tests)
npm run eval               # Component invariant evaluation (24 assertion cases x 3 runs = 72/72)
npm run eval:e2e           # End-to-end evaluation suite (9 complete chat scenarios)
npm run eval:adversarial   # Adversarial security, prompt injection, and integrity evaluation
npm run eval:temporal      # Temporal date & multi-timezone matrix evaluation
npm run eval:stress        # Concurrency & Groq 30 RPM throttler compliance stress test
npm run eval:all           # Run all 5 testing and evaluation suites in sequence
```

### Granular CLI Testing Options

Both `eval` and `eval:e2e` support granular CLI flags for targeted testing:

```bash
# Run specific test cases by ID
npm run eval -- --case=11
npm run eval:e2e -- --case=2 --verbose

# Filter by test category (recall, verifier, budget, fault, security, formatting, generalization)
npm run eval -- --category=verifier
npm run eval:e2e -- --category=hard_case

# Filter by query or description keyword
npm run eval -- --filter="postgres"
npm run eval:e2e -- --filter="pricing"

# Custom repetition count or bail on first failure
npm run eval -- --runs=5 --bail

# Machine-readable JSON output
npm run eval -- --json
npm run eval:e2e -- --json
```

### End-to-End Evaluation Matrix (`npm run eval:e2e`)

Evaluates the complete agent pipeline across core recall questions, edge-case hard scenarios, and out-of-domain generalization boundaries:

| # | Test Scenario | Category | Query | Checks / Criteria | Measured Finding | Status |
|:---:|---|---|---|---|---|:---:|
| **1** | Date-anchored recall & follow-up | Core | *“What did I ask on 3 Nov? Is your answer still correct today?”* | 5 / 6 checks (83.3%) | Recalls Canny, Productboard, UserVoice `[M1, M2]`. Asks permission rather than auto-firing web search for follow-up. | 5/6 checks |
| **2** | Pricing comparison & structured claims | Core | *“Has any CRM tool shortlisted Monday changed pricing since?”* | 6 / 6 checks (100%) | Recalls all 5 tools (HubSpot, Pipedrive, Zoho, Freshsales, Close). 10 web results, 19 citations, 0 verifier flags. | PASS ✅ (6/6) |
| **3** | Postgres pricing & gap detection | Core | *“Last Tuesday I asked about Postgres hosting. Has any pricing changed?”* | 5 / 6 checks (83.3%) | Recalls Supabase & Neon. Gap detection triggered. Verifier caught ungrounded `$0.35` figure in Neon summary. | 5/6 checks |
| **4** | Missing history (honest abstention) | Hard Case | *“What did we agree on with the ACME vendor on 12 August?”* | 100% | Recalls zero notes; cleanly abstains with *"I have no record of ACME vendor or 12 August"* without hallucinating agreements. | PASS ✅ |
| **5** | Ambiguous dates (two readings) | Hard Case | *“What did I ask on Friday?”* | 100% | Disambiguates Friday into primary (Fri 13 Nov) and alternate reading (Fri 6 Nov); retrieves notes for both windows. | PASS ✅ |
| **6** | Failed searches (graceful degradation) | Hard Case | *“What is the current pricing of Linear as of today?”* | 100% | When web search produces no valid pricing records, reports unverified status cleanly instead of inventing prices. | PASS ✅ |
| **7** | Conflicting sources (nuanced reporting) | Hard Case | *“What is the Pro plan price for AcmeCloud?”* | 100% | When secondary sources conflict (e.g. $15/mo blog vs $20/mo official docs), highlights the discrepancy and dates. | PASS ✅ |
| **8** | Stale & undated pages | Hard Case | *“Has WidgetCorp changed pricing since last month?”* | 100% | When pricing sources lack publish dates, verifier flags undated evidence and warns that change timing is unverified. | PASS ✅ |
| **9** | Generalization boundary (out-of-domain) | Generalization | *“Write a Python function to compute compound interest on $10,000 at 5.5%...”* | Boundary Test | Memory finds no notes; grounding verifier flags ungrounded numbers ($10,000, 5.5%, 3), enforcing evidence grounding. | Boundary ❌ (Expected) |

---

### Complete Evaluation Test Suites

In addition to the E2E scenarios above, Almanac runs four specialized automated test suites:

| Suite | Command | Scope | Pass Rate | What It Verifies |
|---|---|---|:---:|---|
| **Component Invariants** | `npm run eval` | 24 cases &times; 3 runs | **72 / 72 (100%)** | FTS5 recall, budget caps, entity quotas, invented-price traps, prompt injection defense, and query timeout isolation. |
| **Adversarial Robustness** | `npm run eval:adversarial` | 6 threat models | **6 / 6 (100%)** | Prompt injection overrides, SQL injection escapes, citation forgery (`[W99]`), HTML/XSS sanitization, and API secret leakage. |
| **Temporal Matrix** | `npm run eval:temporal` | 8 timezones & offsets | **8 / 8 (100%)** | Date parsing across UTC, US/Eastern, Europe/London, Asia/Kolkata (IST), and Pacific/Auckland with DST safety. |
| **Concurrency & Stress** | `npm run eval:stress` | 2 load regimes | **PASS ✅** | Strict 30 RPM throttler compliance across concurrent bursts and 12,000-character evidence budget protection. |
| **Unit Test Suite** | `npm test` | 7 test files | **54 / 54 (100%)** | Unit invariants for date parsing, BM25/vector embeddings, memory injection, search batching, and claim verification. |

## Architecture

See [DESIGN.md](DESIGN.md) for the full architecture, honesty model, failure handling, and measured results.

## Localhost only

This is designed for personal use on localhost and refuses to bind to non-loopback interfaces. Remote hosting is out of scope; it would need user authentication, per-IP rate limits, and a hard spend cap on the provider keys.

## Stack

TypeScript · Node ≥ 22 · Hono · SQLite (better-sqlite3) with FTS5 & Vectors · Google Gemini 2.5 Flash · Nomic Embeddings · Tavily · zod · chrono-node · marked · DOMPurify · vitest
