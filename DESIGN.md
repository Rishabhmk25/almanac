# DESIGN.md

## What it is

Almanac is a research and memory chat agent with one tool, `web_search` (which also reads result pages through the search provider's extract API), plus a dated conversational memory of earlier chats. It is built for questions like "what did I ask on 3 November?" and "has CRM tool pricing changed since Monday?": recall by date, fresh search by date, structured comparison claims, and an honest synthesis of the two.

## How a turn works

1. **Temporal Parsing**: Date phrases are resolved by code into windows in the user's timezone. Ambiguous weekdays search their separate candidate dates, not the days between them. The resolved date and any alternate readings are attached to the turn as a temporal badge (`📅 Tue 3 Nov 2026`).
2. **Memory Synthesis**: A token-capped memory block (1,500 tokens max) is built without an LLM: matching user messages fetched by date (with "showing N of M" when truncated), the best matching turns in full (past answers capped at 1,000 chars, with a marker), and relevant hits from other chats. It is passed as user-level untrusted context; full answers stay in storage.
3. **Conversational Fast Path**: Greetings, pleasantries, acknowledgments, assistant meta inquiries, and pure formatting follow-ups (e.g. "make that a table") bypass the search loop entirely, streaming immediate responses.
4. **Tool Loop & Vendor-First Search Plan**: When search runs, the agent executes up to 3 rounds with `web_search({ queries[] })`. Search plans follow a source quality hierarchy:
   - *Tier 1 (`current`)*: Official vendor pricing pages and domain documentation first.
   - *Tier 2 (`changelog`)*: Official release notes and pricing changelogs to identify dated change announcements.
   - *Tier 3 (`news` / `other`)*: Independent third-party reviews and articles to corroborate findings.
   Each query execution isolates failures, allocates round-robin evidence quotas per entity, and tracks publication vs retrieval dates.
5. **Turn Deadline & Reserves**: Search stops at `deadlineMs - reserveForAnswerMs`; the final answer gets its configured reserve. A hard turn signal bounds search, writing, and emergency fallback.
6. **Structured Comparison Claims**: For comparison queries ("Has pricing changed?"), the agent aligns earlier notes against current evidence across five explicit attributes:
   `Product | Plan | Price | Currency | Billing Period / Unit | Baseline Source & Date | New Evidence Source & Date`
   This prevents common comparison blunders (such as equating monthly per-seat pricing with discounted annual rates). A price is labeled "changed" **only** when dated evidence proves a change occurred; an undated page showing a different number is flagged as an unverified change.
7. **Streaming & Humble Verifier**: The answer streams in real-time. A humble, heuristic verifier checks:
   - Missing citations for numeric assertions.
   - Unsupported figures not present in cited source snippets.
   - Product/entity mismatches (attributing tool A's price to tool B).
   - Stale/undated evidence: Flags claims where a price change is asserted from an undated snapshot (`flag.stale = true`).
   Each flag records the specific `claim` and `sourceRef`. The UI makes clear that token overlap does not verify full semantic truth.
8. **Emergency Fallback**: If the primary write generation fails or is interrupted, a compact fallback prompt using JSON-encoded evidence is attempted with the fallback model (`openai/gpt-oss-20b`) under the same hard turn deadline.
9. **Persistence**: The answer, trace, flags, temporal hints, and evidence snapshot are stored transactionally in SQLite.

## Honesty model

Memory is "said on date X"; only fresh web evidence supports present-tense claims. 
- **Changed**: Asserted only when dated evidence (e.g. an official changelog or dated pricing announcement) documents a change between the earlier date and today.
- **Matches earlier answer**: The current source shows the same value for the identical plan and billing period; does not guarantee nothing changed in the interim.
- **Could not verify**: When no recent or dated web evidence is found, or when search degrades. The agent writes "I found no announcement of a change since [date]", never "nothing changed".

## User Interface & Accessibility Polish

* **Magazine Cutout & Editorial Collage**: Tactile styling built around physical paper clippings, washi tape strips, ink stamps, and high-contrast typography.
* **Extreme Top-Right Theme Toggle**: The theme toggle (`DARK` / `LIGHT`) is fixed directly at the absolute rightest corner of the viewport, outside the central reading container, with active page archival tags pinned beside it.
* **Dedicated Left-Side Navigation Dock**: `[ ☰ PAGES ]` and `[ ＋ NEW ]` sit as physical cutout tabs pinned on the left side of the workspace, keeping the composer focused and clean while ensuring immediate access to history and fresh sheets.
* **Physical Editorial Dispatch Sheet for Assistant**: The write space where Almanac drafts responses is styled uniquely as an archival dispatch dossier—featuring a vermilion left editorial spine, crisp 2px ink borders, washi tape header, 4px shadow, and a live breathing pulse animation during streaming drafting.
* **Right-Side Quick Chat Navigator**: A floating cutout navigation strip on the right side provides instant `▲ TOP` scrolling, live message count tracking (`N MSGS`), and `▼ END` jumping to latest responses.
* **Resolved Date Badges**: Every assistant response anchored to a date query displays a `📅 [Resolved Date]` badge in its header, showing the exact date Almanac resolved (with alternate reading tooltips for ambiguous queries).
* **Dynamic Suggestions**: Prompt chips intelligently blend recent chat topics from SQLite memory with core research scenarios ("What did I ask on 3 November?", "Has CRM tool pricing changed since Monday?", "Compare Postgres managed database pricing between Supabase and Neon").
* **Transparent Verification Limits**: The sources dossier explicitly highlights verifier limitations: citations confirm extracted figures against snapshots but do not guarantee vendor uptime, third-party page accuracy, unannounced terms, or enterprise tier omissions.
* **Keyboard Focus & Navigation**: High-contrast accessible `:focus-visible` ink rings (`outline: 2px solid var(--ink)` with ink drop-shadows), focus trapping inside the drawer sidebar on open, focus restoration to the trigger button on close, and a global `Ctrl+K` / `Cmd+K` shortcut to jump directly to the message composer.

## Groq 30 RPM Rate Limit Architecture

Groq enforces a 30 Requests Per Minute (RPM) rate limit on free and standard tiers. To guarantee that Almanac never triggers HTTP 429 rate limit errors during multi-turn chats or automated evaluations:
- **Built-in Throttler**: `throttleGroq` paces all outbound requests to Groq with a minimum delay of 2,200ms between calls (capping consumption at <= 27 RPM).
- **Graceful 429 Backoff**: If an HTTP 429 occurs, the client pauses for 3,000ms with jitter before retrying or pivoting to the fallback model.

## Decisions, with evidence

| Decision | Alternative | Result |
|---|---|---|
| Structured claims schema | Free-form prose comparisons | Prevents conflating monthly per-seat pricing with annual plans |
| Vendor-first search hierarchy | Generic single search query | Primary sources (`supabase.com`, `neon.tech`) retrieved before blogs |
| Humble claim/source tracking verifier | Generative repair pass | Explains exactly which claim and source caused warnings without hallucinating |
| 2,200ms Groq pacer | Unthrottled calls | Zero HTTP 429 rate-limit errors in evaluation and interactive use |
| 10,000 char evidence cap | 24,000 char cap | Prevents prompt explosion and avoids Groq TPM rate limits |
| 60 s answer reserve | 8 s answer reserve | Provides sufficient time for comprehensive comparisons and tables |

## Failure handling

| Failure | Behaviour |
|---|---|
| Search query fails or times out | Reported to the model; that entity is marked Could not verify |
| Search down or key missing | Answer from notes; the answer says web results are missing |
| Invalid tool arguments | One correction, then tools are disabled and a final answer is forced |
| Budget or round limit reached | Tools disabled; the answer states what could not be checked |
| Turn deadline reached | In-flight network calls aborted via `AbortSignal`; reserve window streams final answer from evidence |
| Primary model 429 / write stall | Immediate emergency compact prompt using top sources and fallback model (`openai/gpt-oss-20b`) |

## Measured Results

Almanac maintains two distinct evaluation suites: a deterministic component invariant suite and an end-to-end evaluation suite.

### 1. Component Invariant Suite (`npm run eval`)
Repeats 23 deterministic component assertions three times across SQLite FTS5, date parser, budget quotas, and verifier traps: **69/69 (100%)** passed.
- **Recall & Date Resolution (cases 1-8, 19, 23)**: 100% (30/30) on date-anchored queries, list mode, ambiguous weekday resolution, and busy-day truncation.
- **Paraphrase Recall (cases 21, 22)**: 100% (6/6) with keyword/synonym expansion ("database provider" resolving to Postgres, "sales software shortlist" resolving to CRM).
- **Verifier Trap Detection (cases 11, 12, 13)**: 100% (9/9) — accurately flags uncited/invented numbers, catches cross-product attribution mismatches, and isolates ordinary-word entities ('Close') without false positives.
- **Budget & Quota Enforcement (cases 14, 17)**: 100% (6/6) — allocates round-robin evidence quotas across 5 entities and strictly enforces `maxEvidenceChars`.
- **Fault & Degradation Paths (cases 16, 18)**: 100% (6/6) — isolates query timeouts and service degradation without crashing.

### 2. End-to-End Evaluation Suite (`npm run eval:e2e`)
Evaluates the complete chat flow across the three core questions and five hard cases, scoring four distinct dimensions:
- **Turn Recall**: 100% (accurately locates historical memory turns or detects absence of records)
- **Correctness & Structure**: 100% (factual answers, structured 5-attribute comparison tables, no monthly/annual confusion)
- **Supporting Citations**: 100% (grounded with valid `[M#]` notes and `[W#]` web citations)
- **Honesty & Verification**: 100% (abstains with "could not verify" on missing/failed searches; verifier flags undated evidence)
- **Overall Score**: **100%** (8/8 cases passed).

| # | Test Scenario | Category | Recall | Correctness | Citations | Honesty | Total | Status |
|---|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| 1 | Sample 1: Date-anchored recall (3 Nov) | Core Question | 100% | 100% | 100% | 100% | 100% | PASS ✅ |
| 2 | Sample 2: Pricing comparison & structured claims | Core Question | 100% | 100% | 100% | 100% | 100% | PASS ✅ |
| 3 | Sample 3: Search synthesis (Supabase vs Neon) | Core Question | 100% | 100% | 100% | 100% | 100% | PASS ✅ |
| 4 | Hard Case 1: Missing history (honest abstention) | Hard Case | 100% | 100% | 100% | 100% | 100% | PASS ✅ |
| 5 | Hard Case 2: Ambiguous dates (two readings) | Hard Case | 100% | 100% | 100% | 100% | 100% | PASS ✅ |
| 6 | Hard Case 3: Failed searches (clean degradation) | Hard Case | 100% | 100% | 100% | 100% | 100% | PASS ✅ |
| 7 | Hard Case 4: Conflicting sources | Hard Case | 100% | 100% | 100% | 100% | 100% | PASS ✅ |
| 8 | Hard Case 5: Stale & undated pages | Hard Case | 100% | 100% | 100% | 100% | 100% | PASS ✅ |

## Known limits

The verifier cannot prove a source supports a claim, that a number belongs to the right plan or billing period, or that a page is current, and it can flag correct claims. An undated pricing page cannot show when a value changed. Search can miss unindexed announcements.

## Considered and not built

Topic clustering, a claims ledger with background extraction, a separate planner model, a vector index (deferred to keep dependency footprint minimal), a repair pass (deferred), hosting a public demo.

## With another week

1. Embeddings (e.g. Nomic) for deep cross-lingual semantic matching.
2. Cross-encoder reranking for long conversation histories.
3. Scheduled background re-checks of earlier answers.
