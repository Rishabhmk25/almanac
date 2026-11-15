# Almanac Design

Almanac is a research and memory chat agent combining dated notebook memory with live web search to answer questions that compare past discussions against present reality.

Detailed technical specs and evaluation breakdowns are in [`docs/detailed-design.md`](./docs/detailed-design.md) and [`EVAL_REPORT.md`](./EVAL_REPORT.md).

---

## 1. The Turn Flow

1. **Temporal Parsing**: Chrono parses date phrases into bounded UTC/local windows. Ambiguous weekdays map to both candidate dates, attaching badges (`Tue 3 Nov 2026`) to the turn.
2. **Hybrid Memory Retrieval**: Combines SQLite FTS5 BM25 keyword matching with dense 768-dimensional embeddings (`Float32Array` BLOBs) via Reciprocal Rank Fusion ($k=60$). A token-capped block (1,500 tokens) provides past messages as untrusted context with tags (`[M1]`).
3. **Main LLM Turn (`tool_choice: 'auto'`)**: The prompt defines routing rules. For greetings, formatting requests, or purely personal notes, the model answers directly without tool calls. For external facts, pricing, or temporal updates, the model emits parallel `web_search` calls.
4. **Parallel Search & Gap Detection**: The server executes query batches in parallel via Tavily. If round 1 leaves shortlisted entities without evidence, round 2 executes targeted re-queries with full-page reading before synthesis.
5. **Strip-and-Flag Pass**: Normalizes Unicode spacing and citation brackets (`[M1]`, `[W1]`). Strips phantom tags that do not exist in the retrieved evidence store and records verification flags. Never injects synthetic citations into unevidenced sentences.
6. **Humble Verifier**: Checks sentence by sentence and cell by cell for uncited numeric figures, snippet mismatches, wrong-product attributions, and undated change assertions.
7. **Transactional Persistence**: Stores user/assistant turns, evidence snapshots, verifier flags, temporal metadata, and vector embeddings atomically in SQLite.

---

## 2. Key Decisions & Alternatives Tried

| Decision | Alternative Actually Tried | Why We Changed |
|---|---|---|
| **Auto tool choice in main call** | Separate LLM query pre-classifier | The pre-classifier added 300–800ms of extra latency, consumed duplicate token quotas, and falsely classified mixed queries like *"What did I ask on 3 Nov? Is it still true today?"* as memory-only, preventing needed search. |
| **Strip-and-flag citation handling** | Regex citation injection & cell rewriting | Heuristically injecting `[M1]` into sentences and replacing unevidenced table cells with `"Could not verify"` was fragile monkey-patching that masked hallucinations. Stripping phantom citations and letting the verifier flag unsupported figures keeps verification honest. |
| **SQLite BLOB Float32Array vectors** | External vector database (Pinecone/Chroma) | Vector databases introduced network hops, separate authentication, and consistency lag. Storing raw `Float32Array` buffers directly in SQLite executes in-memory cosine similarity in <0.2ms with zero external infrastructure. |
| **Google Gemini Flash with Groq fallback** | Single-provider LLM integration | Relying exclusively on one provider risked service interruptions from rate limits (e.g. Free Tier request caps). Automatic failover to Groq (`openai/gpt-oss-20b`) ensures turns complete even when Google's API returns 429. |

---

## 3. Measured Latency & Cost Per Turn

Measurements from component test runs and live evaluation traces:

| Turn Type | Execution Profile | p50 Latency | p95 Latency | Est. Cost / Turn |
|---|---|:---:|:---:|:---:|
| **Direct / Memory Turn** | Hybrid memory search + single direct LLM generation (0 search queries) | 620 ms | 1,150 ms | ~$0.0001 |
| **Search Turn (1 Round)** | Memory retrieval + 3–5 parallel web queries + synthesis + verifier | 3,850 ms | 5,400 ms | ~$0.004 |
| **Search Turn (2 Rounds)** | Memory retrieval + round 1 search + gap detection re-query + synthesis | 5,600 ms | 7,200 ms | ~$0.008 |

- **Component Invariants (`npm run eval`)**: 72 / 72 passed (100%).
- **Adversarial Defenses (`npm run eval:adversarial`)**: 6 / 6 passed (100%).
- **Turn Deadline**: Hard abort at 25,000ms with a guaranteed 8,000ms reserve for answer generation.

---

## 4. Honest Limits

1. **Heuristic Verifier**: Token overlap verification cannot verify deeper semantic validity or confirm that an extracted numeric figure applies to monthly versus annual billing terms if the snippet lacks explicit cycle text.
2. **Undated Web Evidence**: An undated pricing page accessed today confirms only current displayed numbers, not when the price changed. Changes cannot be marked as confirmed without dated changelog evidence.
3. **Unindexed Sources**: Search APIs index public pages with crawl latency; private, paywalled, or freshly modified pages may be missed.

---

## 5. Next Week

1. **Cross-Encoder Neural Reranking**: Add a lightweight cross-encoder to rank retrieved memory snippets when chat history exceeds 100 turns.
2. **Scheduled Price Diff Job**: Background task to periodically re-evaluate shortlisted tools and alert the user when pricing changes.
3. **Visual Table Verification**: Fetch screenshots of vendor pricing grids for multimodal verification against rendered tables.
