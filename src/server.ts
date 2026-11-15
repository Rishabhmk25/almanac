import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { bodyLimit } from 'hono/body-limit';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';

import { cfg } from './config.js';
import { now, nowIso } from './clock.js';
import { getDb } from './db/migrate.js';
import {
  getOrCreateConversation,
  listConversations,
  getConversation,
  removeConversation,
  addMessage,
  recentMessages,
  saveAnswer,
  EvidenceItem,
  Flag,
  TraceStep,
} from './memory/store.js';
import { resolveDateHints } from './agent/time.js';
import { buildMemoryContext } from './memory/inject.js';
import { runAgent } from './agent/loop.js';
import { checkModels } from './llm/groq.js';

// Enforce non-loopback requirement
if (cfg.host !== '127.0.0.1' && cfg.host !== 'localhost' && cfg.host !== '::1' && !cfg.adminToken) {
  console.error('Refusing to start on non-loopback interface without ADMIN_TOKEN');
  process.exit(1);
}

// Initialize database
getDb();

const app = new Hono();

// Vendor files resolution
const require = createRequire(import.meta.url);
const markedPath = path.join(path.dirname(require.resolve('marked/package.json')), 'lib/marked.umd.js');
const purifyPath = path.join(path.dirname(require.resolve('dompurify')), 'purify.min.js');
const markedJs = fs.readFileSync(markedPath, 'utf-8');
const purifyJs = fs.readFileSync(purifyPath, 'utf-8');

app.get('/vendor/marked.umd.js', c => {
  return c.body(markedJs, 200, {
    'Content-Type': 'text/javascript',
  });
});

app.get('/vendor/purify.min.js', c => {
  return c.body(purifyJs, 200, {
    'Content-Type': 'text/javascript',
  });
});

// Security & Hardening middleware on /api/*
app.use('/api/*', async (c, next) => {
  const reqHost = c.req.header('host') ?? '';
  if (!cfg.allowedHosts.has(reqHost)) {
    return c.text('Bad host', 403);
  }

  if (c.req.method !== 'GET') {
    const origin = c.req.header('origin');
    if (origin && !cfg.allowedOrigins.has(origin)) {
      return c.text('Bad origin', 403);
    }
    if (c.req.method !== 'DELETE') {
      const contentType = c.req.header('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        return c.text('JSON only', 415);
      }
    }
  }
  await next();
});

// Limit request body size
app.use(
  '/api/*',
  bodyLimit({
    maxSize: 1024 * 1024, // 1MB
    onError: c => c.text('Payload too large', 413),
  })
);

// GET /api/health
app.get('/api/health', c => {
  return c.json({
    now: now(),
    notices: cfg.notices,
  });
});

// GET /api/conversations
app.get('/api/conversations', c => {
  const convs = listConversations();
  return c.json(convs);
});

// GET /api/conversations/:id
app.get('/api/conversations/:id', c => {
  const id = c.req.param('id');
  const conv = getConversation(id);
  if (!conv) return c.text('Not found', 404);
  return c.json(conv);
});

// DELETE /api/conversations/:id
app.delete('/api/conversations/:id', c => {
  const id = c.req.param('id');
  removeConversation(id);
  return c.body(null, 204);
});

const ChatBodySchema = z.object({
  conversationId: z.string().nullable().optional(),
  message: z.string().min(1).max(4000),
  tz: z.string().default('UTC'),
});

function isValidTimeZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// POST /api/chat
app.post('/api/chat', async c => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.text('Invalid JSON', 400);
  }

  const parseResult = ChatBodySchema.safeParse(body);
  if (!parseResult.success) {
    return c.text('Invalid request body', 400);
  }

  const { conversationId, message, tz: rawTz } = parseResult.data;
  const tz = isValidTimeZone(rawTz) ? rawTz : 'UTC';

  const isStream = c.req.query('stream') !== '0';

  const conv = getOrCreateConversation(conversationId, tz, message);

  // Recent messages for exclusion from search memory
  const recentBefore = recentMessages(conv.id, 6);

  // Add the user message
  const userMsgId = crypto.randomUUID();
  const userMsgTime = now();
  addMessage(conv.id, 'user', message, { id: userMsgId, createdAt: userMsgTime });

  const hints = resolveDateHints(message, userMsgTime, tz);
  const excludeIds = [userMsgId, ...recentBefore.map(m => m.id)];
  const memoryContext = buildMemoryContext(message, hints, conv.id, excludeIds, tz);

  const assistantMsgId = crypto.randomUUID();

  if (!isStream) {
    const abortCtrl = new AbortController();
    try {
      const res = await runAgent(
        {
          conversationId: conv.id,
          userText: message,
          contextBlock: memoryContext.contextBlock,
          memoryItems: memoryContext.memoryItems,
          history: recentBefore,
          tz,
        },
        () => {},
        abortCtrl.signal
      );

      saveAnswer(conv.id, assistantMsgId, res.text, res.evidence, {
        trace: res.trace,
        flags: res.flags,
        budget: res.budget,
        model: cfg.model,
      });

      return c.json({
        id: assistantMsgId,
        conversationId: conv.id,
        text: res.text,
        evidence: res.evidence,
        flags: res.flags,
        trace: res.trace,
        budget: res.budget,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Internal error';
      return c.json({ error: msg }, 500);
    }
  }

  return streamSSE(c, async stream => {
    let partialText = '';
    let completedEvidence: EvidenceItem[] = [];
    let completedFlags: Flag[] = [];
    let completedTrace: TraceStep[] = [];
    let isComplete = false;

    const abortCtrl = new AbortController();

    stream.onAbort(() => {
      abortCtrl.abort();
      if (!isComplete && partialText) {
        saveAnswer(
          conv.id,
          assistantMsgId,
          partialText,
          completedEvidence,
          { trace: completedTrace, flags: completedFlags, model: cfg.model },
          'aborted'
        );
      }
    });

    const emit = async (event: string, data: unknown) => {
      try {
        await stream.writeSSE({
          event,
          data: JSON.stringify(data),
        });
      } catch {
        // Stream write failed or client disconnected
      }
    };

    // Emit initial conversation event
    await emit('conversation', { id: conv.id, title: conv.title });

    try {
      const res = await runAgent(
        {
          conversationId: conv.id,
          userText: message,
          contextBlock: memoryContext.contextBlock,
          memoryItems: memoryContext.memoryItems,
          history: recentBefore,
          tz,
        },
        async (event, data) => {
          if (event === 'token') {
            partialText += (data as { t: string }).t;
          } else if (event === 'reset') {
            partialText = '';
          } else if (event === 'evidence') {
            completedEvidence = (data as { items: EvidenceItem[] }).items;
          } else if (event === 'patch') {
            partialText = (data as { text: string }).text;
            completedFlags = (data as { flags: Flag[] }).flags || [];
          }
          await emit(event, data);
        },
        abortCtrl.signal
      );

      isComplete = true;
      completedEvidence = res.evidence;
      completedFlags = res.flags;
      completedTrace = res.trace;

      const completionTime = now();
      saveAnswer(conv.id, assistantMsgId, res.text, res.evidence, {
        trace: res.trace,
        flags: res.flags,
        budget: res.budget,
        model: cfg.model,
      });

      await emit('done', {
        id: assistantMsgId,
        createdAt: completionTime,
        trace: res.trace,
        budget: res.budget,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error processing request';
      await emit('error', { message: msg });
      if (partialText) {
        saveAnswer(
          conv.id,
          assistantMsgId,
          partialText,
          completedEvidence,
          { trace: completedTrace, flags: completedFlags, model: cfg.model },
          'error'
        );
      }
    }
  });
});

const ImportMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(50000),
  createdAt: z.number().int().positive(),
});

const ImportConversationSchema = z.object({
  title: z.string().max(200).optional(),
  tz: z.string().default('UTC'),
  messages: z.array(ImportMessageSchema).min(1),
});

const ImportPayloadSchema = z.object({
  conversations: z.array(ImportConversationSchema).min(1),
});

// POST /api/import
app.post('/api/import', async c => {
  if (!cfg.adminToken) {
    return c.text('Import disabled (ADMIN_TOKEN not set)', 403);
  }

  const authHeader = c.req.header('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const tokenHash = crypto.createHash('sha256').update(token).digest();
  const expectedHash = crypto.createHash('sha256').update(cfg.adminToken).digest();
  if (!crypto.timingSafeEqual(tokenHash, expectedHash)) {
    return c.text('Unauthorized', 401);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.text('Invalid JSON', 400);
  }

  const parseResult = ImportPayloadSchema.safeParse(body);
  if (!parseResult.success) {
    return c.json({ error: 'Validation error', details: parseResult.error.format() }, 400);
  }

  const db = getDb();
  let totalImported = 0;

  try {
    const runImport = db.transaction((convList: z.infer<typeof ImportPayloadSchema>['conversations']) => {
      for (const convData of convList) {
        const convId = crypto.randomUUID();
        const title = (convData.title || 'Imported chat').slice(0, 50);
        const tz = isValidTimeZone(convData.tz) ? convData.tz : 'UTC';

        getOrCreateConversation(convId, tz, title);

        for (const msg of convData.messages) {
          addMessage(convId, msg.role, msg.content, {
            createdAt: msg.createdAt,
            imported: 1,
          });
          totalImported++;
        }
      }
    });

    runImport(parseResult.data.conversations);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Database transaction failed';
    return c.json({ error: msg }, 500);
  }

  return c.json({ count: totalImported });
});

// Static assets serving from public/
const publicDir = path.join(process.cwd(), 'public');

app.get('/', c => {
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf-8');
  return c.html(html, 200, { 'Cache-Control': 'no-cache, no-store, must-revalidate' });
});

app.get('/styles.css', c => {
  const css = fs.readFileSync(path.join(publicDir, 'styles.css'), 'utf-8');
  return c.body(css, 200, { 'Content-Type': 'text/css', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
});

app.get('/app.js', c => {
  const js = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf-8');
  return c.body(js, 200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
});

checkModels().catch(() => {});

console.log(`Almanac starting on http://${cfg.host}:${cfg.port}`);
serve({
  fetch: app.fetch,
  port: cfg.port,
  hostname: cfg.host,
});

export { app };
