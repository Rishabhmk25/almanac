import crypto from 'node:crypto';
import { getDb } from '../src/db/migrate.js';
import { now } from '../src/clock.js';
import { startOfLocalDay, addLocalDays, dowIn } from '../src/agent/time.js';

export function seedDemoData(): void {
  const db = getDb();
  const nowMs = now();
  const tz = 'UTC';
  const today0 = startOfLocalDay(nowMs, tz);
  const todayDow = dowIn(nowMs, tz);

  // 1. This Monday
  const daysSinceMonday = (todayDow - 1 + 7) % 7;
  const mondayTime = addLocalDays(today0, -daysSinceMonday, tz) + 14 * 3600_000; // 14:00

  // 2. Last Tuesday (if today is Tuesday, 7 days ago; otherwise most recent Tuesday or Tuesday prior)
  const daysSinceTuesday = (todayDow - 2 + 7) % 7;
  const tuesdayTime = addLocalDays(today0, -(daysSinceTuesday === 0 ? 7 : daysSinceTuesday), tz) + 10 * 3600_000;

  // 3. 3 November of current year
  const currentYear = new Date(nowMs).getUTCFullYear();
  let nov3Time = Date.UTC(currentYear, 10, 3, 11, 0, 0); // Month is 0-indexed: 10 = November
  if (nov3Time > nowMs) {
    nov3Time = Date.UTC(currentYear - 1, 10, 3, 11, 0, 0);
  }

  const demos = [
    {
      title: 'CRM shortlist',
      createdAt: mondayTime,
      messages: [
        {
          role: 'user',
          content: "We're shortlisting CRM tools for the sales team. Let's look at HubSpot, Pipedrive, Zoho CRM, Freshsales, and Close.",
          createdAt: mondayTime,
        },
        {
          role: 'assistant',
          content: 'HubSpot, Pipedrive, Zoho CRM, Freshsales, and Close are strong candidates. HubSpot offers broad marketing and sales features, Pipedrive focuses on visual pipeline management, Zoho CRM offers deep enterprise customization, Freshsales emphasizes automation, and Close targets high-velocity outbound teams.',
          createdAt: mondayTime + 120_000,
        },
      ],
    },
    {
      title: 'Postgres hosting',
      createdAt: tuesdayTime,
      messages: [
        {
          role: 'user',
          content: 'What are the main options for managed Postgres hosting?',
          createdAt: tuesdayTime,
        },
        {
          role: 'assistant',
          content: 'Key managed Postgres providers include Supabase, Neon, AWS RDS, and Crunchy Data. They offer features like serverless scaling, branching, and automated backups.',
          createdAt: tuesdayTime + 180_000,
        },
      ],
    },
    {
      title: '3 November chat',
      createdAt: nov3Time,
      messages: [
        {
          role: 'user',
          content: 'What are good tools for tracking customer feedback?',
          createdAt: nov3Time,
        },
        {
          role: 'assistant',
          content: 'Common tools for user feedback include Canny, Productboard, and UserVoice. They help aggregate requests and vote on product roadmaps.',
          createdAt: nov3Time + 90_000,
        },
      ],
    },
  ];

  for (const demo of demos) {
    const convId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO conversations (id, title, tz, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(convId, demo.title, tz, demo.createdAt, demo.createdAt + 300_000);

    let seq = 1;
    for (const msg of demo.messages) {
      const msgId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO messages (id, conversation_id, seq, role, content, created_at, status, meta, imported, demo)
        VALUES (?, ?, ?, ?, ?, ?, 'complete', '{}', 1, 1)
      `).run(msgId, convId, seq++, msg.role, msg.content, msg.createdAt);
    }
  }

  console.log('Seeded 3 demo conversations successfully.');
}

seedDemoData();
