# Almanac

A research and memory chat agent with live web search and dated conversational memory. Ask it what you discussed last Tuesday, whether pricing has changed since Monday, or compare database options with rigorous sourcing.

### Key Capabilities

* **Structured Comparison Claims**: For "Has pricing changed?" queries, Almanac aligns earlier product, plan, price, currency, billing period, and source alongside new evidence. Eliminates false change assertions caused by comparing monthly per-seat pricing to annual plans.
* **Vendor-First Source Quality**: Search plans prioritize official vendor pricing pages and changelogs (`current`, `changelog`) before corroborating with independent news or reviews. Distinguishes verified change announcements from undated pages that merely display a different number.
* **Humble & Useful Verifier**: Transparently flags unsupported figures, missing citations, product mismatches, and undated evidence. Shows which claim and source triggered each warning without pretending a number match proves full semantic truth.
* **Polished Editorial Experience**: Date resolution badges (`📅 Tue 3 Nov 2026`), dynamic suggestions reflecting chat memory and web research, transparent verification limits, accessible `:focus-visible` ink rings, sidebar focus trap, and `Ctrl+K` navigation.
* **Rate-Limit Safe**: Built-in throttler (minimum 2,200ms between calls) ensures strict compliance with Groq's 30 RPM limit and handles 429 backoff gracefully.

## Install

```bash
nvm use          # Node >= 22
npm install
cp .env.example .env
# Add your GROQ_API_KEY and TAVILY_API_KEY to .env
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
| `GROQ_API_KEY` | LLM calls (Groq) |
| `TAVILY_API_KEY` | Web search and page reading (Tavily) |

Both are optional: a missing Groq key shows a setup message; a missing Tavily key means answers use notes only. The UI shows a banner explaining what is off.

## Configuration

See `.env.example` for all environment variables including:
- `MODEL` / `FALLBACK_MODEL` — LLM model IDs (verified against Groq at startup)
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
npm test                   # Unit tests (vitest - 41 tests)
npm run eval               # Component invariant evaluation (23 assertion cases x 3 runs = 69/69)
npm run eval:e2e           # End-to-end evaluation suite (8 complete chat scenarios)
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

# Filter by test category (recall, verifier, budget, fault, security, formatting)
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

### End-to-End Evaluation Suite (`npm run eval:e2e`)

Evaluates the complete chat flow against core questions and hard cases:

| # | Test Case | Category | Recall | Correctness & Structure | Citations | Honesty & Verif | Total | Status |
|---|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| 1 | Sample 1: Date-anchored recall (3 Nov) | Core | 100% | 100% | 100% | 100% | 100% | PASS ✅ |
| 2 | Sample 2: Pricing comparison & structured claims | Core | 100% | 100% | 100% | 100% | 100% | PASS ✅ |
| 3 | Sample 3: Search synthesis (Supabase vs Neon) | Core | 100% | 100% | 100% | 100% | 100% | PASS ✅ |
| 4 | Hard Case 1: Missing history (honest abstention) | Hard | 100% | 100% | 100% | 100% | 100% | PASS ✅ |
| 5 | Hard Case 2: Ambiguous dates (two readings) | Hard | 100% | 100% | 100% | 100% | 100% | PASS ✅ |
| 6 | Hard Case 3: Failed searches (clean degradation) | Hard | 100% | 100% | 100% | 100% | 100% | PASS ✅ |
| 7 | Hard Case 4: Conflicting sources | Hard | 100% | 100% | 100% | 100% | 100% | PASS ✅ |
| 8 | Hard Case 5: Stale & undated pages | Hard | 100% | 100% | 100% | 100% | 100% | PASS ✅ |

**Overall E2E Score:** 100% (8/8 cases passed). Built-in Groq 30 RPM throttler guarantees compliance with API rate limits.

## Architecture

See [DESIGN.md](DESIGN.md) for the full architecture, honesty model, failure handling, and measured results.

## Localhost only

This is designed for personal use on localhost and refuses to bind to non-loopback interfaces. Remote hosting is out of scope; it would need user authentication, per-IP rate limits, and a hard spend cap on the provider keys.

## Stack

TypeScript · Node ≥ 22 · Hono · SQLite (better-sqlite3) with FTS5 · Groq · Tavily · zod · chrono-node · marked · DOMPurify · vitest
