import { z } from 'zod';
import { cfg, BudgetCfg } from '../config.js';
import { now, nowHuman } from '../clock.js';
import { EvidenceItem } from '../memory/store.js';
import { sanitizeTags } from '../memory/inject.js';

export const WebSearchQuery = z.object({
  q: z.string().min(2).max(200),
  entity: z.string().max(80).optional(),
  kind: z.enum(['current', 'news', 'changelog', 'other']).default('other'),
  topic: z.enum(['general', 'news', 'finance']).default('general'),
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  depth: z.enum(['basic', 'advanced']).default('basic'),
  read: z.boolean().default(false),
});
export type Query = z.infer<typeof WebSearchQuery>;

export const WebSearchArgs = z.object({
  queries: z.array(WebSearchQuery).min(1).max(10),
});

export class Budget {
  rounds = 0;
  queries = 0;
  reads = 0;
  evidenceChars = 0;
  readonly startedAt = Date.now();

  constructor(readonly c: BudgetCfg) {}

  get elapsed(): number {
    return Date.now() - this.startedAt;
  }

  get exhausted(): boolean {
    return (
      this.rounds >= this.c.maxRounds ||
      this.queries >= this.c.maxQueries ||
      this.elapsed > this.c.deadlineMs - this.c.reserveForAnswerMs ||
      this.evidenceChars >= this.c.maxEvidenceChars
    );
  }

  room(): number {
    return Math.max(0, Math.min(this.c.maxPerCall, this.c.maxQueries - this.queries));
  }

  snapshot() {
    return {
      rounds: this.rounds,
      queries: this.queries,
      reads: this.reads,
      evidenceChars: this.evidenceChars,
      elapsedMs: this.elapsed,
    };
  }
}

export function prioritise(qs: Query[], room: number): { run: Query[]; dropped: Query[] } {
  const rank = { current: 0, news: 1, changelog: 2, other: 3 } as const;
  const sorted = [...qs].sort((a, b) => rank[a.kind] - rank[b.kind]);
  return { run: sorted.slice(0, room), dropped: sorted.slice(room) };
}

export interface RawResult {
  title: string;
  url: string;
  content: string;
  score?: number;
  published_date?: string | null;
}

interface CacheEntry {
  at: number;
  ttlMs: number;
  results: RawResult[];
}

const searchCache = new Map<string, CacheEntry>();

function cacheKey(q: Query): string {
  return `${q.q.trim().toLowerCase()}|${q.topic}|${q.depth}|${q.since || ''}`;
}

export function canonicalUrl(u: string): string {
  try {
    const parsed = new URL(u);
    for (const p of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
      parsed.searchParams.delete(p);
    }
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return u;
  }
}

export function getDomain(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

async function tavilySearch(q: Query, signal: AbortSignal): Promise<RawResult[]> {
  if (signal.aborted) {
    return [];
  }
  if (cfg.fault === 'tavily_down') {
    throw new Error('Tavily service unavailable (FAULT injected: tavily_down)');
  }
  if (!cfg.tavilyKey) {
    return [];
  }

  const key = cacheKey(q);
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.at < cached.ttlMs) {
    return cached.results;
  }

  const timeoutMs = q.depth === 'advanced' ? cfg.timeouts.searchAdvanced : cfg.timeouts.searchBasic;
  const timeoutCtrl = new AbortController();
  const onParentAbort = () => timeoutCtrl.abort();
  if (signal.aborted) {
    timeoutCtrl.abort();
  } else {
    signal.addEventListener('abort', onParentAbort);
  }
  const timer = setTimeout(() => timeoutCtrl.abort(), timeoutMs);

  try {
    let res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.tavilyKey}`,
      },
      body: JSON.stringify({
        query: q.q,
        topic: q.topic,
        search_depth: q.depth,
        max_results: 5,
        include_answer: false,
        include_raw_content: false,
        ...(q.since ? { start_date: q.since } : {}),
      }),
      signal: timeoutCtrl.signal,
    });

    if (res.status === 429 || res.status >= 500) {
      if (signal.aborted || timeoutCtrl.signal.aborted) {
        throw new Error(`Tavily error: HTTP ${res.status}`);
      }
      // 1 retry with jittered backoff
      await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
      if (signal.aborted || timeoutCtrl.signal.aborted) {
        throw new Error(`Tavily error: HTTP ${res.status}`);
      }
      res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.tavilyKey}`,
        },
        body: JSON.stringify({
          query: q.q,
          topic: q.topic,
          search_depth: q.depth,
          max_results: 5,
          include_answer: false,
          include_raw_content: false,
          ...(q.since ? { start_date: q.since } : {}),
        }),
        signal: timeoutCtrl.signal,
      });
    }

    if (!res.ok) {
      throw new Error(`Tavily error: HTTP ${res.status}`);
    }

    const data = (await res.json()) as { results?: RawResult[] };
    const results = data.results || [];

    const ttlMs = q.topic === 'news' || q.topic === 'finance' ? 5 * 60 * 1000 : 60 * 60 * 1000;
    if (searchCache.size >= 200) {
      const oldestKey = searchCache.keys().next().value;
      if (oldestKey) searchCache.delete(oldestKey);
    }
    searchCache.set(key, { at: Date.now(), ttlMs, results });

    return results;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onParentAbort);
  }
}

async function tavilyExtract(urls: string[], signal: AbortSignal): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!cfg.tavilyKey || urls.length === 0 || signal.aborted) return map;

  const extractCtrl = new AbortController();
  const onParentAbort = () => extractCtrl.abort();
  if (signal.aborted) {
    extractCtrl.abort();
  } else {
    signal.addEventListener('abort', onParentAbort);
  }
  const timer = setTimeout(() => extractCtrl.abort(), 6000);

  try {
    const res = await fetch('https://api.tavily.com/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.tavilyKey}`,
      },
      body: JSON.stringify({ urls }),
      signal: extractCtrl.signal,
    });
    if (res.ok) {
      const data = (await res.json()) as { results?: Array<{ url: string; raw_content?: string }> };
      for (const item of data.results || []) {
        if (item.url && item.raw_content) {
          map.set(canonicalUrl(item.url), item.raw_content);
        }
      }
    }
  } catch {
    // fallback to empty extract map
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onParentAbort);
  }
  return map;
}

function scoreChunk(chunk: string, qTerms: string[]): number {
  let score = 0;
  const lower = chunk.toLowerCase();
  for (const term of qTerms) {
    if (lower.includes(term)) score += 2;
  }
  if (/[\$\€\£\¥]|\bUSD\b|\bEUR\b|\bper\s+(?:month|seat|user|year)\b/i.test(chunk)) {
    score += 3;
  }
  if (/\b\d+(?:\.\d+)?\b/.test(chunk)) {
    score += 1;
  }
  return score;
}

function processPageContent(raw: string, query: string): string {
  // Split into ~800 char chunks
  const chunks: string[] = [];
  const words = raw.split(/\s+/);
  let cur = '';
  for (const w of words) {
    if (cur.length + w.length > 800) {
      chunks.push(cur.trim());
      cur = w + ' ';
    } else {
      cur += w + ' ';
    }
  }
  if (cur.trim()) chunks.push(cur.trim());

  const qTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  const scored = chunks.map(c => ({ text: c, score: scoreChunk(c, qTerms) }));
  scored.sort((a, b) => b.score - a.score);

  const topChunks = scored.slice(0, 2).map(s => s.text);
  let combined = topChunks.join(' ... ');
  if (combined.length > 700) {
    combined = combined.slice(0, 700) + '...';
  }
  return combined;
}

export interface QueryExecutionResult {
  query: Query;
  results: RawResult[];
  error?: string;
}

export async function runBatch(
  queries: Query[],
  budget: Budget,
  signal: AbortSignal
): Promise<QueryExecutionResult[]> {
  const concurrency = 5;
  const queue = [...queries];
  const out: QueryExecutionResult[] = [];

  let queryIndex = 0;

  async function worker() {
    while (queue.length > 0) {
      if (signal.aborted || budget.exhausted) break;
      const q = queue.shift();
      if (!q) break;

      const idx = queryIndex++;
      budget.queries++;

      // Check query_timeout fault
      if (cfg.fault === 'query_timeout' && idx === 0) {
        out.push({ query: q, results: [], error: 'timeout' });
        continue;
      }

      try {
        const raw = await tavilySearch(q, signal);

        // Handle page reading
        if (q.read && budget.reads < budget.c.maxReads && raw.length > 0) {
          const topUrls = raw.slice(0, 2).map(r => r.url);
          budget.reads++;
          const extractedMap = await tavilyExtract(topUrls, signal);
          for (const item of raw) {
            const ext = extractedMap.get(canonicalUrl(item.url));
            if (ext) {
              item.content = processPageContent(ext, q.q);
            }
          }
        }

        out.push({ query: q, results: raw });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'timeout';
        out.push({ query: q, results: [], error: msg.includes('timeout') ? 'timeout' : msg });
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, queries.length) }, () => worker());
  await Promise.all(workers);
  return out;
}

export class EvidenceStore {
  readonly items: EvidenceItem[] = [];
  private wCounter = 1;
  private seenUrls = new Map<string, string>(); // canonicalUrl -> ref

  constructor(initialMemoryItems: EvidenceItem[] = [], budget?: Budget) {
    this.items.push(...initialMemoryItems);
    if (budget) {
      budget.evidenceChars = initialMemoryItems.reduce(
        (sum, item) => sum + (item.snippet?.length || 0) + (item.title?.length || 0),
        0
      );
    }
  }

  add(batchResults: QueryExecutionResult[], budget?: Budget): void {
    if (budget && budget.exhausted) return;

    // Group results by entity
    const byEntity = new Map<string, Array<{ query: Query; r: RawResult }>>();
    for (const res of batchResults) {
      const entity = res.query.entity || 'unlabelled';
      const list = byEntity.get(entity) || [];
      for (const r of res.results) {
        list.push({ query: res.query, r });
      }
      byEntity.set(entity, list);
    }

    const domainCounts = new Map<string, number>();
    for (const item of this.items) {
      if (item.domain) {
        domainCounts.set(item.domain, (domainCounts.get(item.domain) || 0) + 1);
      }
    }

    const entities = Array.from(byEntity.keys());
    const quotaPerEntity = Math.max(2, Math.floor(10 / Math.max(1, entities.length)));

    // Fill round-robin by entity
    let addedAny = true;
    const entityIndices = new Map<string, number>();
    const entityAddedCount = new Map<string, number>();
    for (const e of entities) {
      entityIndices.set(e, 0);
      entityAddedCount.set(e, 0);
    }

    while (addedAny) {
      if (budget && budget.exhausted) break;
      addedAny = false;
      for (const e of entities) {
        if (budget && budget.exhausted) break;
        const list = byEntity.get(e) || [];
        const added = entityAddedCount.get(e) || 0;
        let idx = entityIndices.get(e) || 0;

        if (added >= quotaPerEntity || idx >= list.length) continue;

        while (idx < list.length) {
          const item = list[idx++];
          if (!item) break;
          entityIndices.set(e, idx);

          const cUrl = canonicalUrl(item.r.url);
          const domain = getDomain(cUrl);

          // Dedupe by URL
          if (this.seenUrls.has(cUrl)) continue;

          // Max 2 per domain
          const currentDomainCount = domainCounts.get(domain) || 0;
          if (currentDomainCount >= 2) continue;

          let snippet = sanitizeTags(item.r.content || '');
          const maxSnippet = item.query.read ? 700 : 400;
          if (snippet.length > maxSnippet) {
            snippet = snippet.slice(0, maxSnippet);
          }

          const title = item.r.title || domain || 'Web source';
          let itemChars = snippet.length + title.length;

          if (budget) {
            const remainingBudget = budget.c.maxEvidenceChars - budget.evidenceChars;
            if (remainingBudget <= 0) {
              break;
            }
            if (itemChars > remainingBudget) {
              const allowedSnippetLen = Math.max(0, remainingBudget - title.length);
              if (allowedSnippetLen < 80) {
                // Not enough room for a meaningful snippet
                break;
              }
              snippet = snippet.slice(0, allowedSnippetLen);
              itemChars = snippet.length + title.length;
            }
            budget.evidenceChars += itemChars;
          }

          domainCounts.set(domain, currentDomainCount + 1);

          const ref = `W${this.wCounter++}`;
          this.seenUrls.set(cUrl, ref);

          const evItem: EvidenceItem = {
            ref,
            kind: 'web',
            title,
            entity: item.query.entity,
            url: cUrl,
            domain,
            published: item.r.published_date || null,
            retrievedAt: now(),
            query: item.query.q,
            snippet,
          };

          this.items.push(evItem);
          entityAddedCount.set(e, added + 1);
          addedAny = true;
          break;
        }
      }
    }
  }
}

export function formatToolResult(
  results: QueryExecutionResult[],
  dropped: Query[],
  budget: Budget,
  allKnownEntities: string[] = []
): string {
  const parts: string[] = [];
  parts.push(
    `SEARCH RESULTS (round ${budget.rounds} of ${budget.c.maxRounds}; ${budget.queries} of ${budget.c.maxQueries} queries used; ${budget.reads} of ${budget.c.maxReads} reads used)\n`
  );

  const coveredEntities = new Set<string>();

  for (const res of results) {
    const q = res.query;
    parts.push(`QUERY JSON: ${JSON.stringify({ q: q.q, entity: q.entity || 'unknown', kind: q.kind, since: q.since })}`);

    if (res.error) {
      parts.push(`FAILED: ${res.error}. No evidence for this query.\n`);
      continue;
    }

    if (res.results.length === 0) {
      parts.push(`No results found.\n`);
      continue;
    }

    if (q.entity) coveredEntities.add(q.entity.toLowerCase());

    for (let i = 0; i < Math.min(2, res.results.length); i++) {
      const r = res.results[i];
      if (!r) continue;
      const domain = getDomain(r.url);
      const pub = r.published_date || 'unknown';
      const retrieved = nowHuman('UTC');
      const snippet = sanitizeTags((r.content || '').slice(0, 500));

      parts.push(`UNTRUSTED WEB RESULT JSON: ${JSON.stringify({ domain, published: pub, retrieved, url: canonicalUrl(r.url), snippet })} [published="${pub}"]`);
    }
    parts.push('');
  }

  if (dropped.length > 0) {
    const droppedQueries = dropped.map(d => `"${d.q}"`).join(', ');
    parts.push(`NOT RUN (budget): ${dropped.length} queries (${droppedQueries}).`);
    parts.push(`NOT RUN (budget) JSON: ${JSON.stringify(dropped.map(d => d.q))}`);
  }

  // Check which entities have no evidence yet using word-boundary matching
  if (allKnownEntities.length > 0) {
    const gaps = allKnownEntities.filter(e => !coveredEntities.has(e.toLowerCase()));
    if (gaps.length > 0) {
      parts.push(`ENTITIES WITH NO EVIDENCE YET: ${gaps.join(', ')}.`);
      parts.push(`ENTITIES WITH NO EVIDENCE YET JSON: ${JSON.stringify(gaps)}`);
    }
  }

  return parts.join('\n').trim();
}

