# DESIGN.md

## What it is

Almanac is a chat agent with one tool, `web_search` (which can also read result pages through the search provider's extract API), plus a dated memory of earlier chats. It is built for questions like "what did I ask on 3 November?" and "has anything changed since Monday?": recall by date, fresh search by date, and an honest comparison of the two.

## How a turn works

1. **Temporal Parsing**: Date phrases are resolved by code into windows in the user's timezone. Ambiguous weekdays search their separate candidate dates, not the days between them.
2. **Memory Synthesis**: A token-capped memory block (1,500 tokens max) is built without an LLM: matching user messages fetched by date (with "showing N of M" when truncated), the best matching turns in full (past answers capped at 1,000 chars, with a marker), and relevant hits from other chats. It is passed as user-level untrusted context; full answers stay in storage.
3. **Tool Loop & Budget Guard**: One model runs a loop of at most 3 rounds with a single tool, `web_search({ queries[] })`. The server runs each batch concurrently, with per-entity evidence quotas and isolated failures. `read: true` extracts the top result pages server-side (capped to 700 chars per page). Budgets cover the whole turn: 12 queries, 2 reads, 10,000 evidence characters (calibrated to stay comfortably within Groq's 8,000 TPM limit).
4. **Turn Deadline & Reserves**: Search stops at `deadlineMs - reserveForAnswerMs`; the final answer gets its configured reserve. A hard turn signal bounds search, writing, and emergency fallback.
5. **Tagged Evidence**: Evidence carries stable tags: `[M#]` notes (said on a date) and `[W#]` web results (publish date or "undated", retrieval time).
6. **Streaming & Verification**: The answer streams in real-time. A heuristic verifier checks common numeric figures, including small counts paired with units, against cited snippets. Table metrics inherit their row's product for attribution checks. It inserts `[U#]` markers; it never rewrites, and does not prove semantic support.
7. **Emergency Fallback**: If the primary write generation fails or is interrupted, a compact fallback prompt using JSON-encoded evidence is attempted with the fallback model (`openai/gpt-oss-20b`) under the same hard turn deadline.
8. **Persistence**: The answer, trace, flags, and evidence snapshot are stored transactionally in SQLite.

## Honesty model

Memory is "said on date X"; only fresh web evidence supports present-tense claims. Outcome labels: Changed, Matches earlier answer, Could not verify. "Matches" means the current source shows the same value, not that nothing changed in between. The agent writes "I found no announcement of a change since [date]", not "nothing changed".

## User Interface & Aesthetic

* **Magazine Cutout & Editorial Collage**: Visual styling built around physical paper clippings, washi/masking tape strips, ink stamps, and high-contrast editorial typography.
* **No Generic Top Bar**: Replaced with floating magazine cutout tabs (`[ ☰ PAGES ]`, `[ ＋ NEW ]`) that leave the reading and drafting workspace uncluttered.
* **Hideable Drawer Sidebar**: Slide-in panel for navigating saved chats grouped by date stamp, with one-click page deletion and creation.
* **Typewriter Loading Sequence**: Startup screen with an authentic typewriter card that types out `A L M A N A C` with a blinking vermilion block cursor before peeling back.
* **No Blue Outlines**: Global elimination of default browser blue focus halos on inputs and the composer; focus states use tactile ink drop-shadows (`box-shadow: 8px 8px 0 var(--ink)`).
* **Prompt Suggestions**: Prompt chips use a mix of saved conversation titles and fixed examples.

## Decisions, with evidence

| Decision | Alternative | Result |
|---|---|---|
| Tool loop | Fixed planner pipeline | Tool loop implemented; planner not built |
| BM25 + Query Expansion | Plus Nomic vectors | Deterministic retrieval assertions pass without an external embedding service |
| Flag-only verifier | Repair pass | Flag-only implemented; repair not built |
| 10,000 char evidence cap | 24,000 char cap | Prevents prompt explosion and avoids Groq 8,000 TPM rate-limiting errors |
| 60 s answer reserve | 8 s answer reserve | Provides sufficient time for 4,000+ character technical answers and code generation |

## Failure handling

| Failure | Behaviour |
|---|---|
| Search query fails or times out | Reported to the model; that entity is marked Could not verify |
| Search down or key missing | Answer from notes; the answer says web results are missing |
| Invalid tool arguments | One correction, then tools are disabled and a final answer is forced |
| Budget or round limit reached | Tools disabled; the answer states what could not be checked |
| Turn deadline reached | In-flight network calls aborted via `AbortSignal`; reserve window streams final answer from evidence |
| Primary model 429 / write stall | Immediate emergency compact prompt using top sources and fallback model (`openai/gpt-oss-20b`) |

## Measured

The scorecard repeats 23 deterministic component assertions three times: **69/69 (100%)** passed. This checks helper invariants, not end-to-end answer quality or live search accuracy.

- **Recall & Date Resolution (cases 1-8, 19, 23)**: 100% (30/30) on date-anchored queries, list mode, ambiguous weekday resolution, and busy-day truncation ("showing 40 of 50 user messages; 10 not shown").
- **Paraphrase Recall (cases 21, 22)**: 100% (6/6) with keyword/synonym expansion ("database provider" resolving to Postgres, "sales software shortlist" resolving to CRM).
- **Verifier Trap Detection (cases 11, 12, 13)**: 100% (9/9) — accurately flags uncited/invented numbers, catches cross-product attribution mismatches ($20 HubSpot cited for Pipedrive), and isolates ordinary-word entities ('Close') without false positives.
- **Budget & Quota Enforcement (cases 14, 17)**: 100% (6/6) — allocates round-robin evidence quotas across 5 entities and strictly enforces `maxEvidenceChars`.
- **Fault & Degradation Paths (cases 16, 18)**: 100% (6/6) — isolates query timeouts and service degradation without crashing.

## Known limits

The verifier cannot prove a source supports a claim, that a number belongs to the right plan or billing period, or that a page is current, and it can flag correct claims. An undated pricing page cannot show when a value changed. Search can miss announcements.

## Considered and not built

Topic clustering, a claims ledger with background extraction, a separate planner model, a vector index (deferred to keep dependency footprint minimal), a repair pass (deferred), hosting a public demo.

## With another week

1. Embeddings (e.g. Nomic) for deep cross-lingual semantic matching.
2. Cross-encoder reranking for long conversation histories.
3. Scheduled background re-checks of earlier answers.
