const Database = require('better-sqlite3');
const path = require('path');

let db = null;

function initDB() {
  if (db) return db;

  const dbPath = path.join(__dirname, 'homework.db');
  db = new Database(dbPath);

  // Enable WAL mode for better performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create all tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      openid TEXT UNIQUE,
      nickname TEXT DEFAULT '',
      avatar_url TEXT DEFAULT '',
      role TEXT DEFAULT 'child' CHECK(role IN ('parent', 'child')),
      family_code TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS homework_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT 'other',
      icon TEXT DEFAULT '📌',
      color TEXT DEFAULT '#98D8C8',
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS template_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      item_type TEXT NOT NULL DEFAULT 'text' CHECK(item_type IN ('text', 'math', 'practice')),
      correct_answer TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (template_id) REFERENCES homework_templates(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS daily_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      template_id INTEGER,
      date TEXT NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (template_id) REFERENCES homework_templates(id)
    );

    CREATE TABLE IF NOT EXISTS assignment_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      item_type TEXT NOT NULL DEFAULT 'text',
      correct_answer TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (assignment_id) REFERENCES daily_assignments(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      child_id INTEGER NOT NULL,
      image_urls TEXT DEFAULT '[]',
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'graded', 'failed')),
      ai_result TEXT DEFAULT '',
      is_correct INTEGER,
      score REAL,
      feedback TEXT DEFAULT '',
      submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      graded_at DATETIME,
      FOREIGN KEY (item_id) REFERENCES assignment_items(id),
      FOREIGN KEY (child_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS daily_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_id INTEGER NOT NULL UNIQUE,
      total_items INTEGER DEFAULT 0,
      completed_items INTEGER DEFAULT 0,
      correct_items INTEGER DEFAULT 0,
      completion_rate REAL DEFAULT 0,
      accuracy_rate REAL DEFAULT 0,
      ai_summary TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (assignment_id) REFERENCES daily_assignments(id)
    );

    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT DEFAULT ''
    );
  `);

  console.log('[DB] Database initialized successfully at', dbPath);
  return db;
}

function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDB() first.');
  }
  return db;
}

module.exports = { initDB, getDb };
