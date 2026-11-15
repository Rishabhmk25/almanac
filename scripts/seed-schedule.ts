import crypto from 'node:crypto';
import { getDb } from '../src/db/migrate.js';
import { now } from '../src/clock.js';
import { startOfLocalDay, addLocalDays, dowIn } from '../src/agent/time.js';

export function seedScheduleData(): void {
  const db = getDb();
  const nowMs = now();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
  const today0 = startOfLocalDay(nowMs, tz);
  const todayDow = dowIn(nowMs, tz);

  // Relative days calculation
  const daysSinceMonday = (todayDow - 1 + 7) % 7;
  const mondayTime = addLocalDays(today0, -daysSinceMonday, tz) + 10 * 3600_000; // Mon 10:00 AM
  const mondayAfternoon = addLocalDays(today0, -daysSinceMonday, tz) + 14 * 3600_000 + 30 * 60_000; // Mon 2:30 PM

  const daysSinceTuesday = (todayDow - 2 + 7) % 7;
  const tuesdayTime = addLocalDays(today0, -daysSinceTuesday, tz) + 8 * 3600_000 + 30 * 60_000; // Tue 8:30 AM

  const daysSinceWednesday = (todayDow - 3 + 7) % 7;
  const wednesdayTime = addLocalDays(today0, -daysSinceWednesday, tz) + 11 * 3600_000 + 15 * 60_000; // Wed 11:15 AM

  const daysSinceThursday = (todayDow - 4 + 7) % 7;
  const thursdayTime = addLocalDays(today0, -daysSinceThursday, tz) + 14 * 3600_000 + 45 * 60_000; // Thu 2:45 PM

  const fridayMorning = today0 + 9 * 3600_000; // Fri 9:00 AM

  // Nov 3 & Nov 7 dates
  const currentYear = new Date(nowMs).getFullYear();
  const nov3Time = new Date(currentYear, 10, 3, 15, 0, 0).getTime();
  const nov7Time = new Date(currentYear, 10, 7, 16, 0, 0).getTime();

  const chats = [
    {
      title: 'Weekly Schedule & Sprint 42 Planning',
      createdAt: mondayTime,
      messages: [
        {
          role: 'user' as const,
          content: 'Let’s map out my weekly schedule for this sprint (Nov 9 – Nov 13). What are my recurring meetings, key milestones, and workout times?',
          createdAt: mondayTime,
        },
        {
          role: 'assistant' as const,
          content: `Here is your complete weekly schedule and routine for Sprint 42:

### 1. Recurring Standups & Team Syncs
* **Daily Standup**: Monday through Friday, 09:30 AM – 10:00 AM (Google Meet).
* **Focus Wednesday**: Zero internal meetings scheduled for uninterrupted deep work.
* **Friday Sprint Demo & Retro**: Friday at 04:00 PM with Elena, Sarah, and Dave.
* **Team Virtual Social**: Friday at 05:00 PM.

### 2. Specific Meetings This Week
* **Monday 10:00 AM**: Sprint 42 Kickoff & Backlog Grooming.
* **Monday 02:30 PM**: 1-on-1 Sync with Tech Lead Elena.
* **Tuesday 11:30 AM**: Architecture review for distributed event bus.
* **Thursday 02:00 PM**: Backend guild sync & Kubernetes migration review.
* **Saturday (Nov 14) 11:30 AM**: Client checkpoint meeting with Marcus on Project Falcon.

### 3. Personal Habits & Workouts
* **Gym Workouts**: Monday, Wednesday, and Friday at 06:30 PM (Legs on Wednesday, Upper Body on Friday).
* **Daily Deep Work Windows**: Block 1 (10:00 AM – 01:00 PM) and Block 2 (04:00 PM – 05:30 PM).`,
          createdAt: mondayTime + 60_000,
        },
        {
          role: 'user' as const,
          content: 'What is the most critical rule for scheduling meetings on my calendar?',
          createdAt: mondayTime + 120_000,
        },
        {
          role: 'assistant' as const,
          content: 'The core rule you established: **Never schedule or accept non-critical meetings before 02:00 PM**. Mornings (10:00 AM – 01:00 PM) are strictly reserved for uninterrupted deep work and feature engineering.',
          createdAt: mondayTime + 180_000,
        },
      ],
    },
    {
      title: 'Daily Deep Work Routine & Focus Rules',
      createdAt: tuesdayTime,
      messages: [
        {
          role: 'user' as const,
          content: 'Can you outline my ideal daily productivity routine and time blocks?',
          createdAt: tuesdayTime,
        },
        {
          role: 'assistant' as const,
          content: `Here is your structured daily productivity routine:

| Time Slot | Activity | Guidelines |
|---|---|---|
| **08:00 AM – 09:30 AM** | Morning Prep & Triage | Coffee, async PR reviews, email inbox zero |
| **09:30 AM – 10:00 AM** | Team Standup | Daily sync on Google Meet |
| **10:00 AM – 01:00 PM** | **Deep Work Block 1** | Slack on DND, focused backend coding & system design |
| **01:00 PM – 02:00 PM** | Lunch & Outdoor Walk | Step away from screens |
| **02:00 PM – 04:00 PM** | Collaborative Window | Team syncs, 1-on-1s, architecture reviews, Slack replies |
| **04:00 PM – 05:30 PM** | **Deep Work Block 2** | Bug triage, unit tests, code documentation |
| **05:30 PM – 06:00 PM** | Daily Shutdown | Commit changes, update Jira/Linear, write top 3 tasks for tomorrow |
| **06:30 PM – 07:30 PM** | Workout / Gym | Mon / Wed / Fri sessions |`,
          createdAt: tuesdayTime + 75_000,
        },
        {
          role: 'user' as const,
          content: 'What should I do if someone tries to book a meeting during my morning deep work block?',
          createdAt: tuesdayTime + 150_000,
        },
        {
          role: 'assistant' as const,
          content: 'Decline or politely ask to reschedule to the afternoon collaborative window (after 02:00 PM). Suggest async updates on Slack if a quick question is needed.',
          createdAt: tuesdayTime + 210_000,
        },
      ],
    },
    {
      title: 'Project Falcon Milestones & Client Sync',
      createdAt: wednesdayTime,
      messages: [
        {
          role: 'user' as const,
          content: 'What are our milestones, deadlines, and meeting details for Project Falcon?',
          createdAt: wednesdayTime,
        },
        {
          role: 'assistant' as const,
          content: `Here is the status tracker for **Project Falcon** (Next-Gen E-Commerce Redesign):

### Deliverables & Milestones
* **Milestone 1 (Completed Nov 6)**: Wireframes and Tailwind design system approved by client.
* **Milestone 2 (Due Nov 18)**: Cart state management and Stripe Elements checkout flow.
* **Milestone 3 (Due Nov 25)**: Staging release and load testing with k6 (target: < 200ms P95 latency).
* **Final Production Launch**: Friday, December 4, 2026.

### Upcoming Client Meeting
* **Date & Time**: **Saturday, 14 Nov 2026 at 11:30 AM** (Asia/Kolkata).
* **Client Stakeholder**: Marcus (Lead Product Director).
* **Agenda**:
  1. Live walk-through of the responsive cart prototype.
  2. Discuss guest checkout vs. registered user flow.
  3. Review dark mode theme implementation requested by Marcus.`,
          createdAt: wednesdayTime + 90_000,
        },
        {
          role: 'user' as const,
          content: 'What specific feature did Marcus request in our last call?',
          createdAt: wednesdayTime + 180_000,
        },
        {
          role: 'assistant' as const,
          content: 'Marcus specifically requested **guest checkout without forced account creation** and native support for dark mode matching the user’s OS preference.',
          createdAt: wednesdayTime + 240_000,
        },
      ],
    },
    {
      title: 'Production Release Checklist & CI/CD Workflow',
      createdAt: thursdayTime,
      messages: [
        {
          role: 'user' as const,
          content: 'Review our pre-deployment checklist and automated rollback strategy for production releases.',
          createdAt: thursdayTime,
        },
        {
          role: 'assistant' as const,
          content: `Here is your standard 7-step production release workflow:

1. **Test Verification**: Full test suite must pass cleanly (\`npm test\` and \`npm run typecheck\`).
2. **Backward-Compatible Migrations**: SQLite / Postgres migrations must be verified backward-compatible with the previous release.
3. **Security Audit**: \`npm audit\` with zero critical vulnerabilities; container image scanned with Trivy.
4. **Git Tagging**: Create an annotated release tag (\`git tag -a v2.4.0 -m "Release v2.4.0"\`).
5. **Staging Verification**: Deploy to staging environment; run automated end-to-end smoke tests against staging endpoints.
6. **QA Signoff**: Confirmation received from QA lead Priya.
7. **Canary Rollout**: Initial 10% traffic routing on Kubernetes; monitor metrics for 15 minutes before 100% rollout.

### Automated Rollback Trigger
The CI/CD pipeline triggers an automatic rollback to the previous release if:
* HTTP 5xx error rate exceeds **0.5%** over any 5-minute rolling window, or
* P99 API response latency exceeds **800ms**.`,
          createdAt: thursdayTime + 90_000,
        },
      ],
    },
    {
      title: 'Today Schedule & Friday Task List',
      createdAt: fridayMorning,
      messages: [
        {
          role: 'user' as const,
          content: 'What is my schedule and action plan for today, Friday Nov 13?',
          createdAt: fridayMorning,
        },
        {
          role: 'assistant' as const,
          content: `Here is your agenda and action items for today, **Friday 13 Nov**:

### Today’s Calendar
* **09:30 AM**: Daily Standup (report on PR #42 and memory injection bugfix).
* **11:00 AM**: 1-on-1 sync with Alex regarding Redis cache invalidation.
* **01:00 PM**: Virtual team lunch.
* **02:30 PM**: Code review session for authentication middleware.
* **04:00 PM**: Sprint 42 Demo & Retrospective with Elena, Sarah, and Dave.
* **05:00 PM**: Team Social hangout.
* **06:30 PM**: Gym session (Upper body workout).

### Priority Tasks
1. Submit pull request for memory injection token fix.
2. Prepare briefing notes for tomorrow’s (Saturday Nov 14, 11:30 AM) client meeting with Marcus on Project Falcon.
3. Verify database backup cron job triggers at 02:00 UTC.`,
          createdAt: fridayMorning + 60_000,
        },
      ],
    },
    {
      title: '1-on-1 Notes with Tech Lead Elena',
      createdAt: mondayAfternoon,
      messages: [
        {
          role: 'user' as const,
          content: 'Save my notes from today’s 1-on-1 meeting with Elena.',
          createdAt: mondayAfternoon,
        },
        {
          role: 'assistant' as const,
          content: `Here is the summary of your 1-on-1 with Elena on Monday, 9 Nov:

### Highlights & Feedback
* Elena praised your technical execution on distributed tracing and OpenTelemetry instrumentation in the core API.
* Discussed your promotion pathway to Senior Software Engineer for the Q4 review cycle.
* Elena emphasized taking greater ownership of high-level architecture proposals (RFCs).

### Action Items
1. **Draft RFC**: Write the architecture proposal for the distributed event bus by **Friday, Nov 20**.
2. **Mentorship**: Set up bi-weekly pairing sessions with junior frontend engineer Leo to guide him on TypeScript patterns.
3. **Next 1-on-1**: Scheduled for Monday, Nov 23 at 02:00 PM.`,
          createdAt: mondayAfternoon + 90_000,
        },
      ],
    },
    {
      title: 'Developer Environment & Workspace Setup',
      createdAt: nov3Time,
      messages: [
        {
          role: 'user' as const,
          content: 'What developer tools, shortcuts, and workspace setup do I use for coding?',
          createdAt: nov3Time,
        },
        {
          role: 'assistant' as const,
          content: `Here is your configured developer environment and toolchain:

* **Editor**: VS Code with the Neovim extension, Tokyo Night Dark theme, and JetBrains Mono font with ligatures.
* **Terminal**: Alacritty + Tmux with Starship cross-shell prompt.
* **Notes**: Obsidian vault synced via private Git repository.
* **Primary Keybindings**:
  * \`Cmd+Shift+P\`: Quick action command palette.
  * \`Cmd+K\`: Global search palette.
  * \`Leader + ff\`: Neovim Telescope file finder.
  * \`Leader + fg\`: Live grep search across workspace.
* **Git Aliases**: \`gco\` (checkout), \`gst\` (status), \`gcm\` (commit), \`glg\` (graph log).`,
          createdAt: nov3Time + 90_000,
        },
      ],
    },
    {
      title: 'Weekend Study & Tech Reading List',
      createdAt: nov7Time,
      messages: [
        {
          role: 'user' as const,
          content: 'What topics and papers are on my technical reading list for the weekend?',
          createdAt: nov7Time,
        },
        {
          role: 'assistant' as const,
          content: `Here is your weekend technical study list:

1. **CUDA Parallel Computing**:
   * Study thread and block indexing (\`threadIdx\`, \`blockIdx\`, \`blockDim\`).
   * Shared memory tiling algorithms and \`__syncthreads()\`.
   * Unified memory management with \`cudaMallocManaged\`.
2. **Information Retrieval & Vector Search**:
   * BM25 ranking algorithm and FTS5 inverted indices.
   * Dense embedding reranking and hybrid reciprocal rank fusion (RRF).
3. **High-Performance SQLite**:
   * Write-Ahead Logging (WAL) concurrency.
   * Tuning \`mmap_size\` and \`page_size\` for low-latency queries.`,
          createdAt: nov7Time + 60_000,
        },
      ],
    },
  ];

  for (const chat of chats) {
    const convId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO conversations (id, title, tz, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(convId, chat.title, tz, chat.createdAt, chat.messages[chat.messages.length - 1].createdAt);

    let seq = 1;
    for (const msg of chat.messages) {
      const msgId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO messages (id, conversation_id, seq, role, content, created_at, status, meta, imported, demo)
        VALUES (?, ?, ?, ?, ?, ?, 'complete', '{}', 1, 0)
      `).run(msgId, convId, seq++, msg.role, msg.content, msg.createdAt);
    }
  }

  const counts = {
    conversations: (db.prepare('SELECT count(*) as c FROM conversations').get() as { c: number }).c,
    messages: (db.prepare('SELECT count(*) as c FROM messages').get() as { c: number }).c,
  };

  console.log(`✓ Seeded ${chats.length} schedule & workflow conversations into Almanac:`);
  console.log(`  Total Conversations: ${counts.conversations}`);
  console.log(`  Total Messages: ${counts.messages}`);
}

seedScheduleData();

