# Almanac

A research and memory chat agent combining live web search with dated conversational memory. Ask it what you discussed last Tuesday, whether pricing has changed since Monday, or compare tool options with sourcing.

### Key Capabilities

* **Dense Embeddings & Hybrid RRF**: Combines SQLite FTS5 BM25 keyword matching with dense 768-dimensional embeddings via Reciprocal Rank Fusion, resolving conceptual paraphrases without manual synonyms.
* **Google Gemini 3.6 Flash Engine**: Reasoning with native tool calling and high token throughput, enabling multi-round search gap filling.
* **Automated Gap Detection & Targeted Re-Query**: After search round 1, Almanac programmatically checks which entities lack evidence. Round 2 specifically executes targeted re-queries with full page reads for missing entities.
* **Autonomous Tool Routing**: With `tool_choice: 'auto'`, the model evaluates user query intent in the main turn, answering directly for greetings, formatting requests, and private notes without separate classifier latency.
* **Structured Comparison Claims**: For "Has pricing changed?" queries, Almanac aligns earlier product, plan, price, currency, billing period, and source alongside new evidence. Eliminates false change assertions caused by comparing monthly per-seat pricing to annual plans.
* **Vendor-First Source Quality**: Search plans prioritize official vendor pricing pages and changelogs (`current`, `changelog`) before corroborating with independent news or reviews. Distinguishes verified change announcements from undated pages that merely display a different number.
* **Humble Verifier**: Transparently flags unsupported figures, missing citations, product mismatches, and undated evidence. Shows which claim and source triggered each warning without pretending a number match proves full semantic truth.
* **User Interface**: Date resolution badges (`Tue 3 Nov 2026`), dynamic suggestions reflecting chat memory and web research, transparent verification limits, accessible `:focus-visible` ink rings, sidebar focus trap, and `Ctrl+K` navigation.

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

## API Keys

| Key | Purpose | Status |
|---|---|---|
| `GEMINI_API_KEY` | Primary LLM calls (Gemini 3.6 Flash) | Required for generation (or set `GROQ_API_KEY`) |
| `TAVILY_API_KEY` | Web search and page reading (Tavily) | Required for live search; without it, searches are skipped and answers rely on notes only |
| `NOMIC_API_KEY` | Nomic Embed API for semantic vector memory | Optional (falls back to local subword embedding generation) |
| `GROQ_API_KEY` | Fallback LLM calls | Optional (automatic failover when Gemini hits rate limits) |

When keys are omitted, the agent boots in offline/notes-only mode with an explanatory UI banner.

## Configuration

See `.env.example` for all environment variables including:
- `MODEL` / `FALLBACK_MODEL` — LLM model IDs (defaults to `gemini-3.6-flash` / `gemini-3.5-flash-lite`)
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
npm test                   # Unit tests (vitest - 8 test files, 55 tests passing hermetically)
npm run eval               # Component invariant evaluation (24 assertion cases x 3 runs = 72 checks)
npm run eval:e2e           # End-to-end evaluation suite (3 scenarios)
npm run eval:adversarial   # Adversarial security, prompt injection, and integrity evaluation (6 cases)
npm run eval:temporal      # Temporal date & multi-timezone matrix evaluation (8 cases)
npm run eval:stress        # Concurrency & rate-limit stress test
npm run eval:all           # Run all evaluation suites in sequence
```

### End-to-End Evaluation Scenarios (`npm run eval:e2e`)

Evaluates the agent pipeline across core recall questions and live search synthesis:

| # | Test Scenario | Category | Query | Checks / Criteria |
|:---:|---|---|---|---|
| **1** | Date-anchored recall & follow-up | Core | *“What did I ask on 3 Nov? Is your answer still correct today?”* | Recalls customer feedback tools `[M1]`, searches current web data `[W#]`, checks if answer is current. |
| **2** | Pricing comparison & structured claims | Core | *“Has any CRM tool shortlisted Monday changed pricing since?”* | Recalls shortlisted tools (HubSpot, Pipedrive, Zoho, Freshsales, Close), fetches web evidence, compares baseline vs current. |
| **3** | Postgres pricing & gap detection | Core | *“Last Tuesday I asked about Postgres hosting. Has any pricing changed?”* | Recalls Supabase & Neon, executes gap detection re-queries for missing entities, validates figures via humble verifier. |

Evaluation artifacts and scorecards are stored in [`docs/`](./docs/).

## Architecture

See [DESIGN.md](DESIGN.md) for the one-page design, turn flow, measured latencies, and decisions. Full reference documentation is archived in [`docs/detailed-design.md`](docs/detailed-design.md).

## Localhost only

This is designed for personal use on localhost and refuses to bind to non-loopback interfaces. Remote hosting is out of scope; it would need user authentication, per-IP rate limits, and a hard spend cap on the provider keys.

## Stack

TypeScript · Node ≥ 22 · Hono · SQLite (better-sqlite3) with FTS5 & Vectors · Google Gemini 3.6 Flash · Tavily · zod · chrono-node · marked · DOMPurify · vitest
