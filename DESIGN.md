# Almanac Design

Almanac is a research and memory chat agent combining dated notebook memory with live web search to answer questions that compare past discussions against present reality.

Detailed technical specs and evaluation records are in [`docs/detailed-design.md`](./docs/detailed-design.md) and [`docs/EVAL_REPORT.md`](./docs/EVAL_REPORT.md).

---

## 1. Turn Flow

1. **Temporal Parsing**: Chrono parses date phrases into bounded UTC/local windows. Ambiguous weekdays resolve to both candidate dates, attaching badges (`Tue 3 Nov 2026`) to the turn.
2. **Hybrid Memory Retrieval**: Combines SQLite FTS5 BM25 keyword search with dense 768-dimensional embeddings (`Float32Array` BLOBs) via Reciprocal Rank Fusion ($k=60$). A token-capped block (default `MEMORY_TOKEN_CAP=2000`) injects past messages as untrusted context with memory tags (`[M1]`).
3. **Main Turn Execution (`tool_choice: 'auto'`)**: The prompt defines routing rules. For greetings, formatting requests, or personal notes, the model answers directly without tool calls. For external facts, pricing updates, or verification of past answers, the model emits parallel `web_search` calls.
4. **Parallel Search & Gap Detection**: The server executes query batches in parallel via Tavily. If round 1 leaves entities without evidence, round 2 executes targeted re-queries with full-page extraction before synthesis.
5. **Strip-and-Flag Pass**: Normalizes bracket syntax (`[ M1 ]` to `[M1]`). Strips phantom tags that do not exist in the retrieved evidence store and records verification flags. Does not inject synthetic citations into unevidenced text.
6. **Humble Verifier**: Checks sentence by sentence and table cell by cell for uncited numeric figures, snippet text mismatches, product misattributions, and undated change assertions.
7. **Transactional Persistence**: Stores turns, evidence items, verifier flags, temporal hints, and vector embeddings in SQLite.
8. **Timeouts**: Bound by `DEADLINE_MS=60000` with `RESERVE_FOR_ANSWER_MS=25000` reserved for final answer streaming.

---

## 2. Key Decisions & Alternatives Actually Tried

| Decision | Alternative Actually Tried | Reason for Change |
|---|---|---|
| **Autonomous tool choice in main call** | Separate LLM query pre-classifier and regex rules | The pre-classifier added 300–800ms of latency per turn, burned extra token quota, and falsely classified compound queries like *"What did I ask on 3 Nov? Is it still correct today?"* as memory-only, preventing needed search. |
| **Strip-and-flag citation handling** | Regex citation injection & cell rewriting | Auto-inserting `[M1]` after date phrases and rewriting table cells to `"Could not verify"` was brittle and masked hallucinations. Stripping phantom citations and letting the verifier flag unsupported figures keeps verification honest. |
| **Hybrid RRF vector + BM25 search** | Pure BM25 keyword search alone | Pure BM25 failed whenever queries used conceptual paraphrases (such as *"database providers"* for notes mentioning *"managed Postgres hosting"*). Combining BM25 with dense subword embeddings via RRF resolved vocabulary mismatches. |
| **Gemini Flash with Groq fallback** | Single-provider LLM integration | Relying exclusively on one provider caused turn dropouts during rate-limit spikes (such as free-tier daily request caps). Automatic failover to Groq (`openai/gpt-oss-20b`) prevents turn failures when Google's API returns 429. |

---

## 3. Latency & Cost Per Turn

Local pipeline overhead (memory retrieval + strip-and-flag + verification) measures **1.54 ms p50** on local SQLite benchmarks ([`docs/latency-benchmarks.json`](./docs/latency-benchmarks.json)). Total turn latency and cost depend on network hops and search rounds:

| Turn Type | Profile | Estimated p50 | Estimated p95 | Est. Cost / Turn |
|---|---|:---:|:---:|:---:|
| **Direct Turn** | Memory recall + 1 direct generation round (0 web searches) | ~600 ms | ~1,200 ms | ~$0.0001 |
| **Search Turn (1 Round)** | Memory retrieval + 3–5 parallel web queries + synthesis + verification | ~3,800 ms | ~5,400 ms | ~$0.004 |
| **Search Turn (2 Rounds)** | Round 1 search + automated gap re-query + extract + synthesis + verification | ~5,600 ms | ~7,200 ms | ~$0.008 |

- **Unit Tests (`npm test`)**: 55 / 55 passing hermetically without external API keys.
- **Component Invariants (`npm run eval`)**: 24 assertion cases across 3 repetitions (72 checks).
- **End-to-End Scenarios (`npm run eval:e2e`)**: 3 full multi-turn evaluation cases.

---

## 4. Honest Limits

1. **Heuristic Verification**: Token overlap verification cannot verify deeper semantic validity or confirm billing frequency terms if the source snippet lacks explicit cycle text.
2. **Undated Web Evidence**: An undated pricing page accessed today confirms only current displayed numbers, not when the price changed. Changes cannot be marked as confirmed without dated changelog evidence.
3. **Crawl Coverage**: Search APIs index public pages with crawl delay; gated, paywalled, or freshly modified pages may be missed.

---

## 5. Next Week

1. **Cross-Encoder Neural Reranking**: Add a cross-encoder model to rank retrieved memory snippets when chat history exceeds 100 turns.
2. **Scheduled Price Diff Watcher**: Background job to periodically re-evaluate shortlisted tools and notify the user when pricing changes.
3. **Visual Table Verification**: Fetch screenshots of vendor pricing grids for multimodal verification against rendered tables.
