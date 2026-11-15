import crypto from 'node:crypto';
import { getDb } from '../db/migrate.js';
import { now } from '../clock.js';

export interface EvidenceItem {
  ref: string;                    // 'W1' | 'M1'
  kind: 'web' | 'memory';
  title: string;
  entity?: string;                // as the model labelled it
  url?: string;
  domain?: string;
  published?: string | null;      // as returned by the provider; null = undated
  retrievedAt?: number;           // epoch ms (web)
  query?: string;                 // web: the query that found it
  when?: number;                  // memory: when it was said
  conversationTitle?: string;     // memory
  snippet: string;                // exactly what the model saw (trimmed)
}

export interface Flag {
  id: string;                     // id = 'U1'..
  reason: string;
}

export interface TraceStep {
  stage: string;
  ms: number;
  note?: string;
}

export interface MessageMeta {
  trace?: TraceStep[];
  flags?: Flag[];
  budget?: Record<string, unknown>;
  model?: string;
  rounds?: number;
  queries?: number;
  reads?: number;
  elapsedMs?: number;
  degraded?: string[];
}

export interface MessageRow {
  rid?: number;
  id: string;
  conversation_id: string;
  seq: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: number;
  status: 'complete' | 'aborted' | 'error';
  evidence: string | null;
  meta: string;
  imported: number;
  demo: number;
}

const STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'could', 'did', 'do', 'does', 'doing', 'down', 'during',
  'each', 'few', 'for', 'from', 'further',
  'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how',
  'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself',
  'just', 'let', 'me', 'more', 'most', 'my', 'myself',
  'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own',
  'same', 'she', 'should', 'so', 'some', 'such',
  'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too',
  'under', 'until', 'up', 'us', 'very',
  'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'with', 'would',
  'you', 'your', 'yours', 'yourself', 'yourselves',
  // Conversational meta-words
  'ask', 'asked', 'asking', 'answer', 'answered', 'answers', 'say', 'said', 'tell', 'told', 'still', 'correct',
  'question', 'questions', 'chat', 'chats', 'discuss', 'discussed', 'talk', 'talked', 'check', 'recheck',
  'instead', 'study', 'studied', 'studying', 'learn', 'learned', 'learning', 'know', 'knew', 'remember', 'recall',
  'note', 'notes', 'read', 'reading', 'write', 'wrote', 'find', 'found', 'mention', 'mentioned', 'search', 'searched'
]);

export function ftsQuery(text: string): string | null {
  const cleaned = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim();

  if (!cleaned) return null;

  const tokens = cleaned
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOPWORDS.has(t));

  const unique = Array.from(new Set(tokens)).slice(0, 12);
  if (unique.length === 0) return null;

  return unique.map(t => `"${t.replace(/"/g, '""')}"`).join(' OR ');
}

export function getOrCreateConversation(
  id: string | null | undefined,
  tz: string,
  firstMessage?: string
): { id: string; title: string; tz: string; createdAt: number; updatedAt: number } {
  const db = getDb();
  const t = now();

  if (id) {
    const row = db.prepare('SELECT id, title, tz, created_at, updated_at FROM conversations WHERE id = ?').get(id) as {
      id: string;
      title: string;
      tz: string;
      created_at: number;
      updated_at: number;
    } | undefined;

    if (row) {
      return {
        id: row.id,
        title: row.title || 'Untitled page',
        tz: row.tz,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    }
  }

  const newId = id || crypto.randomUUID();
  const rawTitle = firstMessage ? firstMessage.trim().slice(0, 50) : 'Untitled page';
  const title = rawTitle || 'Untitled page';

  db.prepare(`
    INSERT INTO conversations (id, title, tz, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(newId, title, tz || 'UTC', t, t);

  return { id: newId, title, tz: tz || 'UTC', createdAt: t, updatedAt: t };
}

export function updateConversationTitle(id: string, title: string): void {
  const db = getDb();
  db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(title.slice(0, 50), now(), id);
}

export function addMessage(
  convId: string,
  role: 'user' | 'assistant',
  content: string,
  opts?: {
    id?: string;
    createdAt?: number;
    status?: 'complete' | 'aborted' | 'error';
    evidence?: EvidenceItem[];
    meta?: MessageMeta;
    imported?: number;
    demo?: number;
  }
): MessageRow {
  const db = getDb();
  const msgId = opts?.id || crypto.randomUUID();
  const msgTime = opts?.createdAt ?? now();
  const status = opts?.status ?? 'complete';
  const evJson = opts?.evidence ? JSON.stringify(opts.evidence) : null;
  const metaJson = JSON.stringify(opts?.meta ?? {});
  const imported = opts?.imported ?? 0;
  const demo = opts?.demo ?? 0;

  const nextSeqRow = db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS nextSeq FROM messages WHERE conversation_id = ?').get(convId) as { nextSeq: number };
  const seq = nextSeqRow.nextSeq;

  db.prepare(`
    INSERT INTO messages (id, conversation_id, seq, role, content, created_at, status, evidence, meta, imported, demo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(msgId, convId, seq, role, content, msgTime, status, evJson, metaJson, imported, demo);

  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(msgTime, convId);

  return {
    id: msgId,
    conversation_id: convId,
    seq,
    role,
    content,
    created_at: msgTime,
    status,
    evidence: evJson,
    meta: metaJson,
    imported,
    demo,
  };
}

export function recentMessages(convId: string, limit = 6): Array<{ id: string; role: 'user' | 'assistant'; content: string }> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, role, content FROM messages
    WHERE conversation_id = ? AND status = 'complete'
    ORDER BY seq DESC LIMIT ?
  `).all(convId, limit) as Array<{ id: string; role: 'user' | 'assistant'; content: string }>;

  return rows.reverse();
}

export function countUserMessages(win: { from: number; to: number }, excludeIds: string[] = []): number {
  const db = getDb();
  const excludeJson = JSON.stringify(excludeIds);
  const row = db.prepare(`
    SELECT COUNT(*) AS c FROM messages
    WHERE role = 'user' AND created_at >= ? AND created_at < ?
      AND id NOT IN (SELECT value FROM json_each(?))
  `).get(win.from, win.to, excludeJson) as { c: number };

  return row.c;
}

export function userMessagesIn(
  win: { from: number; to: number },
  limit: number,
  excludeIds: string[] = []
): Array<{ id: string; createdAt: number; chat: string; content: string }> {
  const db = getDb();
  const excludeJson = JSON.stringify(excludeIds);
  const rows = db.prepare(`
    SELECT m.id, m.created_at AS createdAt, c.title AS chat, m.content
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.role = 'user' AND m.created_at >= ? AND m.created_at < ?
      AND m.id NOT IN (SELECT value FROM json_each(?))
    ORDER BY m.created_at ASC
    LIMIT ?
  `).all(win.from, win.to, excludeJson, limit) as Array<{ id: string; createdAt: number; chat: string; content: string }>;

  return rows;
}

export function bm25(
  ftsQ: string,
  win?: { from: number; to: number },
  limit = 10,
  excludeIds: string[] = []
): Array<{ id: string; conversationId: string; seq: number; score: number }> {
  const db = getDb();
  const excludeJson = JSON.stringify(excludeIds);
  const from = win ? win.from : null;
  const to = win ? win.to : null;

  const rows = db.prepare(`
    SELECT m.id, m.conversation_id AS conversationId, m.seq, bm25(messages_fts) AS score
    FROM messages_fts
    JOIN messages m ON m.rid = messages_fts.rowid
    WHERE messages_fts MATCH :q
      AND (:from IS NULL OR m.created_at >= :from)
      AND (:to   IS NULL OR m.created_at <  :to)
      AND m.id NOT IN (SELECT value FROM json_each(:exclude))
    ORDER BY score ASC
    LIMIT :limit
  `).all({ q: ftsQ, from, to, exclude: excludeJson, limit }) as Array<{
    id: string;
    conversationId: string;
    seq: number;
    score: number;
  }>;

  return rows;
}

export function turnOf(
  convId: string,
  seq: number
): Array<{ id: string; role: 'user' | 'assistant'; content: string; created_at: number; seq: number }> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, role, content, created_at, seq
    FROM messages
    WHERE conversation_id = ? AND seq BETWEEN ? AND ?
    ORDER BY seq ASC
  `).all(convId, seq - 1, seq + 1) as Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    created_at: number;
    seq: number;
  }>;

  return rows;
}

export function saveAnswer(
  convId: string,
  id: string,
  content: string,
  evidence: EvidenceItem[],
  meta: MessageMeta,
  status: 'complete' | 'aborted' | 'error' = 'complete'
): void {
  const db = getDb();
  const msgTime = now();
  const evJson = JSON.stringify(evidence);
  const metaJson = JSON.stringify(meta);

  // Check if message already exists
  const existing = db.prepare('SELECT id FROM messages WHERE id = ?').get(id);
  if (existing) {
    db.prepare(`
      UPDATE messages
      SET content = ?, evidence = ?, meta = ?, status = ?
      WHERE id = ?
    `).run(content, evJson, metaJson, status, id);
  } else {
    const nextSeqRow = db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS nextSeq FROM messages WHERE conversation_id = ?').get(convId) as { nextSeq: number };
    db.prepare(`
      INSERT INTO messages (id, conversation_id, seq, role, content, created_at, status, evidence, meta, imported, demo)
      VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?, ?, 0, 0)
    `).run(id, convId, nextSeqRow.nextSeq, content, msgTime, status, evJson, metaJson);
  }

  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(msgTime, convId);
}

export function listConversations(limit = 200): Array<{ id: string; title: string; createdAt: number; updatedAt: number }> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, title, created_at AS createdAt, updated_at AS updatedAt
    FROM conversations
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(limit) as Array<{ id: string; title: string; createdAt: number; updatedAt: number }>;

  return rows;
}

export function getConversation(id: string): {
  id: string;
  title: string;
  tz: string;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    createdAt: number;
    status: string;
    evidence: EvidenceItem[];
    meta: MessageMeta;
    demo: boolean;
  }>;
} | null {
  const db = getDb();
  const conv = db.prepare('SELECT id, title, tz FROM conversations WHERE id = ?').get(id) as { id: string; title: string; tz: string } | undefined;
  if (!conv) return null;

  const msgRows = db.prepare(`
    SELECT id, role, content, created_at, status, evidence, meta, demo
    FROM messages
    WHERE conversation_id = ?
    ORDER BY seq ASC
  `).all(id) as Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    created_at: number;
    status: string;
    evidence: string | null;
    meta: string;
    demo: number;
  }>;

  const messages = msgRows.map(m => {
    let evidence: EvidenceItem[] = [];
    try {
      if (m.evidence) evidence = JSON.parse(m.evidence);
    } catch {}

    let meta: MessageMeta = {};
    try {
      if (m.meta) meta = JSON.parse(m.meta);
    } catch {}

    return {
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.created_at,
      status: m.status,
      evidence,
      meta,
      demo: Boolean(m.demo),
    };
  });

  return {
    id: conv.id,
    title: conv.title || 'Untitled page',
    tz: conv.tz,
    messages,
  };
}

export function removeConversation(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
}

