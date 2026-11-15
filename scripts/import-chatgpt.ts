import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDb } from '../src/db/migrate.js';
import { addMessage, getOrCreateConversation } from '../src/memory/store.js';

interface ChatGPTMessageNode {
  id: string;
  message?: {
    id: string;
    author: {
      role: string;
    };
    create_time?: number | null;
    content?: {
      content_type?: string;
      parts?: any[];
      text?: string;
    };
    status?: string;
  } | null;
  parent?: string | null;
  children?: string[];
}

interface ChatGPTConversation {
  title?: string;
  create_time?: number;
  update_time?: number;
  mapping?: Record<string, ChatGPTMessageNode>;
  messages?: Array<{
    role: string;
    content: string | { parts?: string[] };
    create_time?: number;
    createdAt?: number;
  }>;
}

export function parseChatGPTConversations(rawJson: string): Array<{
  title: string;
  tz: string;
  createdAt: number;
  messages: Array<{ role: 'user' | 'assistant'; content: string; createdAt: number }>;
}> {
  const parsed = JSON.parse(rawJson);
  const convList: ChatGPTConversation[] = Array.isArray(parsed) ? parsed : [parsed];
  const out: Array<{
    title: string;
    tz: string;
    createdAt: number;
    messages: Array<{ role: 'user' | 'assistant'; content: string; createdAt: number }>;
  }> = [];

  for (const item of convList) {
    const title = (item.title || 'ChatGPT conversation').trim().slice(0, 50);
    const convTime = item.create_time ? Math.floor(item.create_time * 1000) : Date.now();
    const messages: Array<{ role: 'user' | 'assistant'; content: string; createdAt: number }> = [];

    if (item.mapping && typeof item.mapping === 'object') {
      // Traverse nodes or collect valid messages
      const nodes = Object.values(item.mapping);

      // Sort nodes chronologically if create_time exists
      const validNodes = nodes
        .filter(n => n.message && (n.message.author.role === 'user' || n.message.author.role === 'assistant'))
        .sort((a, b) => {
          const tA = a.message?.create_time ?? 0;
          const tB = b.message?.create_time ?? 0;
          return tA - tB;
        });

      for (const n of validNodes) {
        const msg = n.message!;
        const role = msg.author.role === 'user' ? 'user' : 'assistant';
        let content = '';

        if (msg.content) {
          if (Array.isArray(msg.content.parts)) {
            content = msg.content.parts
              .filter(p => typeof p === 'string' && p.trim().length > 0)
              .join('\n')
              .trim();
          } else if (typeof msg.content.text === 'string') {
            content = msg.content.text.trim();
          }
        }

        if (!content) continue;

        const msgTime = msg.create_time ? Math.floor(msg.create_time * 1000) : convTime;
        messages.push({ role, content, createdAt: msgTime });
      }
    } else if (Array.isArray(item.messages)) {
      for (const msg of item.messages) {
        const role = msg.role === 'user' ? 'user' : 'assistant';
        let content = '';
        if (typeof msg.content === 'string') {
          content = msg.content.trim();
        } else if (msg.content && Array.isArray(msg.content.parts)) {
          content = msg.content.parts.filter(p => typeof p === 'string').join('\n').trim();
        }
        if (!content) continue;

        const msgTime = msg.createdAt ?? (msg.create_time ? Math.floor(msg.create_time * 1000) : convTime);
        messages.push({ role, content, createdAt: msgTime });
      }
    }

    if (messages.length > 0) {
      out.push({
        title,
        tz: 'UTC',
        createdAt: convTime,
        messages,
      });
    }
  }

  return out;
}

export function importConversationsIntoDb(conversations: ReturnType<typeof parseChatGPTConversations>): {
  conversationsCount: number;
  messagesCount: number;
} {
  const db = getDb();
  let convCount = 0;
  let msgCount = 0;

  const insertTx = db.transaction((list: typeof conversations) => {
    for (const c of list) {
      const convId = crypto.randomUUID();
      getOrCreateConversation(convId, c.tz, c.title);

      // Update conversation created_at
      db.prepare('UPDATE conversations SET created_at = ?, updated_at = ? WHERE id = ?').run(
        c.createdAt,
        c.messages[c.messages.length - 1]?.createdAt || c.createdAt,
        convId
      );

      for (const m of c.messages) {
        addMessage(convId, m.role, m.content, {
          createdAt: m.createdAt,
          imported: 1,
        });
        msgCount++;
      }
      convCount++;
    }
  });

  insertTx(conversations);

  return { conversationsCount: convCount, messagesCount: msgCount };
}

// CLI entrypoint
const filePath = process.argv[2];

if (filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.error(`File not found: ${resolved}`);
    process.exit(1);
  }

  console.log(`Reading ChatGPT export from ${resolved}...`);
  const raw = fs.readFileSync(resolved, 'utf-8');
  const parsed = parseChatGPTConversations(raw);
  console.log(`Parsed ${parsed.length} conversations.`);

  const stats = importConversationsIntoDb(parsed);
  console.log(`✓ Successfully imported into Almanac:`);
  console.log(`  Conversations: ${stats.conversationsCount}`);
  console.log(`  Messages: ${stats.messagesCount}`);
} else if (process.argv[1]?.endsWith('import-chatgpt.ts')) {
  console.log('Usage: npx tsx scripts/import-chatgpt.ts <path-to-conversations.json>');
}

