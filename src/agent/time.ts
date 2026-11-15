import * as chrono from 'chrono-node';

export interface TemporalHint {
  phrase: string;
  from: number;          // epoch ms, inclusive
  to: number;            // epoch ms, exclusive
  label: string;         // "Tue 3 Nov 2026"
  alt?: TemporalHint;    // second reading when ambiguous
}

export function tzOffsetMs(ms: number, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(ms);
    const get = (type: string): number => Number(parts.find(p => p.type === type)?.value ?? 0);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    return asUtc - Math.floor(ms / 1000) * 1000;
  } catch {
    return 0;
  }
}

export function localMidnight(y: number, m: number, d: number, tz: string): number {
  const utc = Date.UTC(y, m - 1, d);
  let t = utc - tzOffsetMs(utc, tz);
  t = utc - tzOffsetMs(t, tz); // second pass settles DST edges
  return t;
}

export function startOfLocalDay(ms: number, tz: string): number {
  try {
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
    const parts = ymd.split('-').map(Number);
    const y = parts[0] ?? 1970;
    const m = parts[1] ?? 1;
    const d = parts[2] ?? 1;
    return localMidnight(y, m, d, tz);
  } catch {
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
}

export function addLocalDays(startMs: number, n: number, tz: string): number {
  return startOfLocalDay(startMs + n * 86_400_000 + 12 * 3_600_000, tz); // noon trick avoids DST drift
}

export function fmtLabel(ms: number, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    }).format(ms).replace(/,/g, '');
  } catch {
    return new Date(ms).toUTCString();
  }
}

const DOW = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

export function dowIn(ms: number, tz: string): number {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(ms).toLowerCase();
    return DOW.indexOf(name as (typeof DOW)[number]);
  } catch {
    return new Date(ms).getUTCDay();
  }
}

export function weekdayHints(text: string, nowMs: number, tz: string): TemporalHint[] {
  const out: TemporalHint[] = [];
  const today0 = startOfLocalDay(nowMs, tz);
  const todayDow = dowIn(nowMs, tz);

  for (const m of text.toLowerCase().matchAll(/\b(last|this past)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/g)) {
    const dayStr = m[2] ?? '';
    const target = DOW.indexOf(dayStr as (typeof DOW)[number]);
    if (target < 0) continue;
    const isLast = Boolean(m[1]);
    const back = (todayDow - target + 7) % 7; // 0 = today is that weekday

    const day = (daysBack: number): TemporalHint => {
      const from = addLocalDays(today0, -daysBack, tz);
      return {
        phrase: m[0].trim(),
        from,
        to: Math.min(addLocalDays(from, 1, tz), nowMs),
        label: fmtLabel(from, tz),
      };
    };

    if (back === 0) {
      const primary = isLast ? day(7) : day(0);
      if (!isLast) primary.alt = day(7); // "Thursday" said on a Thursday: today OR last week
      out.push(primary);
    } else {
      const primary = day(back);
      if (isLast) primary.alt = day(back + 7); // "last Tuesday": this week's or the week before
      out.push(primary);
    }
  }
  return out;
}

export function resolveDateHints(text: string, nowMs: number, tz: string): TemporalHint[] {
  const hints: TemporalHint[] = [];
  const lower = text.toLowerCase();
  const today0 = startOfLocalDay(nowMs, tz);

  // 1. Hours ago
  for (const m of lower.matchAll(/\b(?:(\d+)\s+hours?\s+ago|an\s+hour\s+ago)\b/g)) {
    const n = m[1] ? parseInt(m[1], 10) : 1;
    const from = nowMs - (n + 1) * 3600_000;
    hints.push({
      phrase: m[0],
      from,
      to: nowMs,
      label: fmtLabel(from, tz),
    });
  }

  // 2. Today, earlier, this morning, this afternoon
  for (const m of lower.matchAll(/\b(earlier\s+today|this\s+morning|this\s+afternoon|earlier|today)\b/g)) {
    hints.push({
      phrase: m[0],
      from: today0,
      to: nowMs,
      label: fmtLabel(today0, tz),
    });
  }

  // 3. Yesterday
  for (const m of lower.matchAll(/\byesterday\b/g)) {
    const from = addLocalDays(today0, -1, tz);
    hints.push({
      phrase: m[0],
      from,
      to: today0,
      label: fmtLabel(from, tz),
    });
  }

  // 4. Past N days
  for (const m of lower.matchAll(/\bpast\s+(\d+)\s+days\b/g)) {
    const n = parseInt(m[1] ?? '1', 10);
    const from = addLocalDays(today0, -n, tz);
    hints.push({
      phrase: m[0],
      from,
      to: nowMs,
      label: `${fmtLabel(from, tz)} to ${fmtLabel(today0, tz)}`,
    });
  }

  // 5. Last week (Mon to Sun)
  for (const m of lower.matchAll(/\blast\s+week\b/g)) {
    const todayDow = dowIn(nowMs, tz);
    const daysSinceMonday = (todayDow + 6) % 7;
    const thisMonday = addLocalDays(today0, -daysSinceMonday, tz);
    const prevMonday = addLocalDays(thisMonday, -7, tz);
    hints.push({
      phrase: m[0],
      from: prevMonday,
      to: thisMonday,
      label: `${fmtLabel(prevMonday, tz)} to ${fmtLabel(addLocalDays(thisMonday, -1, tz), tz)}`,
    });
  }

  // 6. Last month
  for (const m of lower.matchAll(/\blast\s+month\b/g)) {
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).format(nowMs);
    const [yStr = '1970', mStr = '1'] = ymd.split('-');
    let y = parseInt(yStr, 10);
    let mNum = parseInt(mStr, 10) - 1; // 0-based prev month
    if (mNum === 0) {
      mNum = 12;
      y -= 1;
    }
    const from = localMidnight(y, mNum, 1, tz);
    const nextM = mNum === 12 ? 1 : mNum + 1;
    const nextY = mNum === 12 ? y + 1 : y;
    const to = localMidnight(nextY, nextM, 1, tz);
    hints.push({
      phrase: m[0],
      from,
      to,
      label: `${fmtLabel(from, tz)}`,
    });
  }

  // 7. Weekdays
  hints.push(...weekdayHints(text, nowMs, tz));

  // 8. Explicit dates via chrono-node
  const tzOffsetMin = Math.round(tzOffsetMs(nowMs, tz) / 60000);
  const parsedChrono = chrono.parse(text, { instant: new Date(nowMs), timezone: tzOffsetMin });

  for (const r of parsedChrono) {
    if (r.start.isCertain('month')) {
      let date = r.start.date();
      if (!r.start.isCertain('year') && date.getTime() > nowMs) {
        date.setFullYear(date.getFullYear() - 1);
      }
      const dayStart = startOfLocalDay(date.getTime(), tz);
      const dayEnd = addLocalDays(dayStart, 1, tz);
      hints.push({
        phrase: r.text,
        from: dayStart,
        to: Math.min(dayEnd, Math.max(dayStart + 86400000, nowMs)),
        label: fmtLabel(dayStart, tz),
      });
    }
  }

  return hints;
}

