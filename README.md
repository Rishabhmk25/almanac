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

### Live End-to-End Evaluation (`npm run eval:live`)

Evaluates the real, live pipeline (`gemini-3.5-flash` + Tavily search) with zero mock responses:

| # | Test Scenario | Query | Checks Passed | Failing Check / Finding | Status |
|---|---|---|:---:|---|:---:|
| 1 | Date-anchored recall & follow-up | *“What did I ask on 3 Nov? Is your answer still correct today?”* | **5 / 6 (83.3%)** | Live web evidence cited (recalled memory [M1, M2], but asked user instead of auto-searching) | 5/6 checks |
| 2 | Pricing comparison & structured claims | *“Has any CRM tool shortlisted Monday changed pricing since?”* | **6 / 6 (100%)** | None (HubSpot, Pipedrive, Zoho, Freshsales, Close; 10 web results, 19 citations, 0 flags) | PASS ✅ (6/6) |
| 3 | Postgres pricing & gap detection | *“Last Tuesday I asked about Postgres hosting. Has any pricing changed?”* | **5 / 6 (83.3%)** | Verifier flag: `$0.35 is not in the cited source` (verifier correctly caught ungrounded number in Neon synthesis) | 5/6 checks |

**Overall Live Check Pass Rate:** **16 / 18 checks passed (88.9%)** (1/3 full case passes). Results are written to [`scorecard-e2e.json`](scorecard-e2e.json).

## Architecture

See [DESIGN.md](DESIGN.md) for the full architecture, honesty model, failure handling, and measured results.

## Localhost only

This is designed for personal use on localhost and refuses to bind to non-loopback interfaces. Remote hosting is out of scope; it would need user authentication, per-IP rate limits, and a hard spend cap on the provider keys.

## Stack

TypeScript · Node ≥ 22 · Hono · SQLite (better-sqlite3) with FTS5 & Vectors · Google Gemini 2.5 Flash · Nomic Embeddings · Tavily · zod · chrono-node · marked · DOMPurify · vitest
