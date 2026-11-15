import dotenv from 'dotenv';
dotenv.config();

export function now(): number {
  if (process.env['NOW_OVERRIDE']) {
    const parsed = Date.parse(process.env['NOW_OVERRIDE']);
    if (!isNaN(parsed)) return parsed;
  }
  return Date.now();
}

export function nowIso(): string {
  return new Date(now()).toISOString();
}

export function nowHuman(tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now()).replace(/,/g, '');
  } catch {
    return new Date(now()).toUTCString();
  }
}

