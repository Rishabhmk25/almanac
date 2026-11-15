import { getDb } from '../src/db/migrate.js';

const db = getDb();

db.transaction(() => {
  db.exec(`
    DELETE FROM messages;
    DELETE FROM conversations;
    DELETE FROM messages_fts;
  `);
})();

db.exec('VACUUM;');

const counts = {
  conversations: (db.prepare('SELECT count(*) as c FROM conversations').get() as { c: number }).c,
  messages: (db.prepare('SELECT count(*) as c FROM messages').get() as { c: number }).c,
};

console.log('✓ Almanac database reset to zero:');
console.log(`  Conversations: ${counts.conversations}`);
console.log(`  Messages: ${counts.messages}`);
