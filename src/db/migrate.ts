import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from '../config.js';

let dbInstance: Database.Database | null = null;

export function getDb(customPath?: string): Database.Database {
  if (dbInstance && !customPath) return dbInstance;

  const dbPath = customPath || path.join(cfg.dataDir, 'almanac.db');
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  migrate(db);

  dbInstance = db;
  return db;
}

export function migrate(db: Database.Database): void {
  const versionRow = db.pragma('user_version', { simple: true }) as number;
  let currentVersion = typeof versionRow === 'number' ? versionRow : 0;

  // Read migrations directory
  const migrationsDir = path.join(import.meta.dirname, 'migrations');
  
  if (!fs.existsSync(migrationsDir)) return;

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const match = file.match(/^(\d+)_/);
    if (!match || !match[1]) continue;
    const version = parseInt(match[1], 10);
    if (version > currentVersion) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      db.transaction(() => {
        db.exec(sql);
        db.pragma(`user_version = ${version}`);
      })();
      currentVersion = version;
    }
  }
}
