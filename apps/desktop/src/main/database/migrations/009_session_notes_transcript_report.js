/**
 * Migration 009 - sessions become complete work sessions
 *
 *  - ai_sessions: `notes` (user notes), `ended_at` (session closed), `report_json`
 *    (generated report) and `report_generated_at`
 *  - session_transcripts: live transcription lines of a session, "mic" (the user)
 *    or "system" (audio playing on the computer)
 *
 * Idempotent: columns and table are only created when missing.
 */
const version = 9;

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

function up(db) {
  addColumn(db, 'ai_sessions', 'notes', 'TEXT');
  addColumn(db, 'ai_sessions', 'ended_at', 'INTEGER');
  addColumn(db, 'ai_sessions', 'report_json', 'TEXT');
  addColumn(db, 'ai_sessions', 'report_generated_at', 'INTEGER');

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_transcripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('mic', 'system')),
      text TEXT NOT NULL,
      spoken_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES ai_sessions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_session_transcripts_session ON session_transcripts(session_id, spoken_at);
  `);
}

function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_session_transcripts_session;
    DROP TABLE IF EXISTS session_transcripts;
  `);
  // SQLite cannot drop columns cheaply; the new ai_sessions columns are nullable and safe to keep.
  console.log('Down migration for 009: ai_sessions columns are kept (nullable)');
}

module.exports = { version, up, down };
