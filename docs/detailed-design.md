# Almanac Detailed Architecture & Reference Design

> **Note**: This is the extended reference archive for Almanac. For the one-page overview, see [`DESIGN.md`](../DESIGN.md).

## What it is

Almanac is a research and memory chat agent with one tool, `web_search` (which also reads result pages through the search provider's extract API), plus a dated conversational memory powered by hybrid lexical (SQLite FTS5 BM25) and semantic vector search (Nomic Embed v1.5). It is built for questions like "what did I ask on 3 November?" and "has CRM tool pricing changed since Monday?": recall by date, fresh search by date, structured comparison claims, and an honest synthesis of the two.

## How a turn works

1. **Temporal Parsing**: Date phrases are resolved by code into windows in the user's timezone. Ambiguous weekdays search their separate candidate dates, not the days between them. The resolved date and any alternate readings are attached to the turn as a temporal badge (`Tue 3 Nov 2026`).
2. **Hybrid Semantic Memory Synthesis**: Memory search combines SQLite FTS5 BM25 with dense vector embeddings (Nomic Embed v1.5, 768 dimensions) using Reciprocal Rank Fusion (RRF). This matches both exact keyword tokens (tool names, dates) and semantic paraphrases ("database providers" resolving to "managed Postgres hosting"). A token-capped memory block (2,000 tokens max) is built without an LLM: matching user messages fetched by date, the best matching turns in full (past answers capped at 1,000 chars, with a marker), and relevant hits from other chats. It is passed as user-level untrusted context; full answers stay in storage.
3. **Autonomous Routing & Tool Calling**: Using native function declarations with `tool_choice: 'auto'`, the main LLM call autonomously decides whether live search is needed. Greetings, pleasantries, acknowledgments, formatting adjustments, and private notebook inquiries bypass web search without extra classifier latency.
4. **Multi-Round Parallel Search & Gap Detection**: When search runs, the agent executes targeted parallel queries with `web_search({ queries[] })`. Search plans follow a strict source quality hierarchy:
   - *Tier 1 (`current`)*: Official vendor pricing pages and domain documentation first.
   - *Tier 2 (`changelog`)*: Official release notes and pricing changelogs to identify dated change announcements.
   - *Tier 3 (`news` / `other`)*: Independent third-party reviews and articles to corroborate findings.
   - *Automated Gap Detection & Targeted Re-Query*: After search round 1, the agent inspects the evidence store against all expected entities. Any entity lacking evidence (e.g. from failed queries, quota limits, or dropped items) is flagged as a gap. Round 2 specifically executes targeted re-queries with `read: true` for these missing entities before writing the final synthesized answer.
   Each query execution isolates failures, allocates round-robin evidence quotas per entity, and tracks publication vs retrieval dates.
5. **Turn Deadline & Reserves**: Search stops early at `deadlineMs - reserveForAnswerMs`; the final answer gets its configured reserve. A hard turn signal bounds search, writing, and emergency fallback.
6. **Structured Comparison Claims**: For comparison queries ("Has pricing changed?"), the agent aligns earlier notes against current evidence across five explicit attributes:
   `Product | Plan | Price | Currency | Billing Period / Unit | Baseline Source & Date | New Evidence Source & Date`
   This prevents common comparison blunders (such as equating monthly per-seat pricing with discounted annual rates). A price is labeled "changed" **only** when dated evidence proves a change occurred; an undated page showing a different number is flagged as an unverified change.
7. **Strip-and-Flag Pipeline**: A deterministic pass normalizes formatting and strips phantom citations:
   - *Bracket Normalization*: Normalizes narrow Unicode spaces (`\u202f`), double brackets (`[[M1]]`), bracket spaces (`[ M1 ]`), and parenthesized citations (`(M1)`) to standard `[M1]` and `[W1]`.
   - *Phantom Citation Stripping & Flagging*: Strips tags that do not exist in the evidence store and records a verification warning.
8. **Humble Verifier**: The answer streams in real-time. A humble, heuristic verifier checks:
   - Missing citations for numeric assertions.
   - Unsupported figures not present in cited source snippets.
   - Product/entity mismatches (attributing tool A's price to tool B).
   - Stale/undated evidence: Flags claims where a price change is asserted from an undated snapshot (`flag.stale = true`).
   Each flag records the specific `claim` and `sourceRef`. The UI makes clear that token overlap does not verify full semantic truth.
9. **Emergency Fallback & Resilience**: If primary generation encounters an issue, a compact fallback prompt using JSON-encoded evidence is attempted under the same hard turn deadline.
10. **Persistence**: The answer, trace, flags, temporal hints, vectors, and evidence snapshot are stored transactionally in SQLite.

## Honesty model

Memory is "said on date X"; only fresh web evidence supports present-tense claims. 
- **Changed**: Asserted only when dated evidence (e.g. an official changelog or dated pricing announcement) documents a change between the earlier date and today.
- **Matches earlier answer**: The current source shows the same value for the identical plan and billing period; does not guarantee nothing changed in the interim.
- **Different value (unconfirmed change)**: When current sources show a different number but lack a dated announcement, the agent states both figures honestly without asserting an unverified change.
- **Could not verify**: When no recent or dated web evidence is found, or when search degrades. The agent writes "I found no announcement of a change since [date]", never "nothing changed".

## LLM Architecture: Google Gemini 3.6 Flash

Almanac uses **Google Gemini 3.6 Flash** as its primary reasoning engine (with `gemini-3.5-flash-lite` fallback and optional Groq compatibility).
- **Ultra-Fast Reasoning & High Throughput**: With fast generation and generous token throughput, Gemini Flash enables deep evidence capacity (expanded to 12,000 characters) without prompt truncation or HTTP 413 payload errors.
- **Native Tool Calling**: Uses Gemini's native function calling declarations for `web_search` with strict parameter validation.
- **Multi-Round Search Gap Filling**: Higher limits allow the agent to inspect round 1 results and run follow-up targeted queries for entities that had missing or incomplete evidence.
- **Seamless Groq Fallback**: If running in an environment with legacy Groq keys, Almanac automatically routes requests to Groq with rate-limit pacing.

## Semantic Memory: Dense Embeddings + Hybrid RRF

To solve paraphrase and semantic recall without relying on fragile keyword synonyms:
- **Nomic Embed Text v1.5 / Gemini Embeddings**: 768-dimensional embeddings with task-specific prefixes (`search_document:` for stored notebook messages, `search_query:` for incoming questions).
- **SQLite BLOB Storage**: Embedding vectors are stored directly in SQLite (`message_embeddings` table) as raw `Float32Array` IEEE 754 byte buffers, requiring 0 external vector DB infrastructure.
- **Reciprocal Rank Fusion (RRF)**: Combines BM25 lexical rank with cosine similarity rank:
  $$\text{RRF}(d) = \frac{1.0}{60 + \text{rank}_{\text{bm25}}(d)} + \frac{1.2}{60 + \text{rank}_{\text{vec}}(d)}$$
- **Multi-Tier Embedding Fallback**: Nomic API -> Gemini `text-embedding-004` -> local deterministic semantic feature projection (guaranteeing 100% offline test compliance).

## Failure handling

| Failure | Behaviour |
|---|---|
| Search query fails or times out | Reported to the model; that entity is marked Could not verify |
| Search down or key missing | Answer from notes; the answer says web results are missing |
| Invalid tool arguments | One correction, then tools are disabled and a final answer is forced |
| Budget or round limit reached | Tools disabled; the answer states what could not be checked |
| Turn deadline reached | In-flight network calls aborted via `AbortSignal`; reserve window streams final answer from evidence |
| Primary LLM 429 / error | Immediate switch to fallback model (`gemini-3.5-flash-lite` / Groq) |

## Measured Results

Almanac maintains five distinct evaluation suites:
1. **Live Real-API Evaluation (`npm run eval:live`)**: Tested against live LLM and live Tavily search APIs on core queries.
2. **Component Invariant Suite (`npm run eval`)**: 24 deterministic component assertions across 3 runs (**72/72 passed, 100%**) covering date parsing, hybrid search recall, verifier traps, and budget quotas.
3. **End-to-End Evaluation Suite (`npm run eval:e2e`)**: Complete chat scenarios across core questions and hard edge cases.
4. **Adversarial Robustness Suite (`npm run eval:adversarial`)**: Prompt injection, SQL injection, citation spoofing, and HTML sanitization (**6/6 passed, 100%**).
5. **Temporal & Timezone Matrix (`npm run eval:temporal`)**: Multi-timezone weekday and date window resolution (**8/8 passed, 100%**).
