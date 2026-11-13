/**
 * Migration 008 - metadata of AI answers and conversation titles
 *
 *  - ai_messages: which provider/model produced the answer, how long it took and its tokens
 *  - ai_sessions: `title` (the conversation subject)
 *
 * Idempotent (checks the columns first) and backfills what can be recovered from old rows:
 * the answer's model from the matching `ai_runs` row and the title from the first user message.
 */
const version = 8;

function columnsOf(db, table) {
  return db
    .prepare(`PRAGMA table_info('${table}')`)
    .all()
    .map((row) => row.name);
}

function addColumn(db, table, name, type) {
  if (!columnsOf(db, table).includes(name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
}

/** First line of the first user message, cut at a word boundary (kept in sync with src/common/chat.ts). */
function titleFrom(text) {
  const clean = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return null;
  if (clean.length <= 60) return clean;
  const cut = clean.slice(0, 60);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 30 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

function up(db) {
  addColumn(db, 'ai_messages', 'provider_id', 'TEXT');
  addColumn(db, 'ai_messages', 'model_name', 'TEXT');
  addColumn(db, 'ai_messages', 'duration_ms', 'INTEGER');
  addColumn(db, 'ai_messages', 'tokens_in', 'INTEGER');
  addColumn(db, 'ai_messages', 'tokens_out', 'INTEGER');
  addColumn(db, 'ai_sessions', 'title', 'TEXT');

  // The run is saved right after the answer, so the first successful run of the session
  // that is not older than the message is the one that produced it.
  db.exec(`
    UPDATE ai_messages SET
      provider_id = (
        SELECT r.provider_id FROM ai_runs r
        WHERE r.session_id = ai_messages.session_id AND r.status = 'success' AND r.created_at >= ai_messages.created_at
        ORDER BY r.created_at ASC LIMIT 1),
      model_name = (
        SELECT r.model_name FROM ai_runs r
        WHERE r.session_id = ai_messages.session_id AND r.status = 'success' AND r.created_at >= ai_messages.created_at
        ORDER BY r.created_at ASC LIMIT 1),
      duration_ms = (
        SELECT r.duration_ms FROM ai_runs r
        WHERE r.session_id = ai_messages.session_id AND r.status = 'success' AND r.created_at >= ai_messages.created_at
        ORDER BY r.created_at ASC LIMIT 1)
    WHERE role = 'assistant' AND provider_id IS NULL
  `);

  const sessions = db.prepare(`SELECT id FROM ai_sessions WHERE title IS NULL OR title = ''`).all();
  const firstUser = db.prepare(
    `SELECT content FROM ai_messages WHERE session_id = ? AND role = 'user' ORDER BY created_at ASC, id ASC LIMIT 1`
  );
  const setTitle = db.prepare(`UPDATE ai_sessions SET title = ? WHERE id = ?`);
  for (const { id } of sessions) {
    const row = firstUser.get(id);
    const title = row ? titleFrom(row.content) : null;
    if (title) setTitle.run(title, id);
  }
}

function down() {
  // SQLite cannot drop columns cheaply; the new columns are nullable and safe to keep.
  console.log('Down migration for 008: columns are kept (nullable)');
}

module.exports = { version, up, down, titleFrom };
