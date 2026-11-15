# Almanac

A chat agent with web search and dated memory. Ask it what you discussed last Tuesday, whether pricing has changed since Monday, or any question that needs current web data with honest sourcing.

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
- `HOST` / `PORT` — Server binding (localhost by default; any other host requires `ADMIN_TOKEN`)
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

## Quality gates

```bash
npm run typecheck   # TypeScript strict check
npm test            # Unit tests (vitest)
npm run eval        # 23-case eval suite (3 runs each)
```

## Architecture

See [DESIGN.md](DESIGN.md) for the full architecture, honesty model, failure handling, and measured results.

## Localhost only

This is designed for personal use on localhost. Hosting it publicly would need sessions, per-IP rate limits, and a hard spend cap on the provider keys. That is out of scope.

## Stack

TypeScript · Node ≥ 22 · Hono · SQLite (better-sqlite3) with FTS5 · Groq · Tavily · zod · chrono-node · marked · DOMPurify · vitest
