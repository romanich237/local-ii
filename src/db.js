'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { root } = require('./config');

const dbPath = path.join(root, 'data.db');
const legacyDbPath = path.join(root, 'data', 'local-ai.db');

if (!fs.existsSync(dbPath) && fs.existsSync(legacyDbPath)) {
  for (const suffix of ['', '-wal', '-shm']) {
    const source = `${legacyDbPath}${suffix}`;
    const destination = `${dbPath}${suffix}`;
    if (fs.existsSync(source)) fs.renameSync(source, destination);
  }
  console.log('SQLite: база перенесена из data/local-ai.db в data.db');
}

const db = new Database(dbPath);
fs.chmodSync(dbPath, 0o600);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    key_prefix TEXT NOT NULL,
    monthly_limit INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TEXT
  );
  CREATE TABLE IF NOT EXISTS usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_id INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    model TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    status_code INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_usage_key_date ON usage_events(key_id, created_at);
`);

const statements = {
  findKey: db.prepare('SELECT * FROM api_keys WHERE key_hash = ? AND enabled = 1'),
  createKey: db.prepare('INSERT INTO api_keys(name,key_hash,key_prefix,monthly_limit) VALUES(?,?,?,?)'),
  listKeys: db.prepare(`SELECT k.id,k.name,k.key_prefix,k.monthly_limit,k.enabled,k.created_at,k.last_used_at,
    COALESCE(SUM(CASE WHEN u.created_at >= datetime('now','start of month') THEN u.total_tokens ELSE 0 END),0) month_tokens
    FROM api_keys k LEFT JOIN usage_events u ON u.key_id=k.id GROUP BY k.id ORDER BY k.id DESC`),
  monthUsage: db.prepare("SELECT COALESCE(SUM(total_tokens),0) total FROM usage_events WHERE key_id=? AND created_at >= datetime('now','start of month')"),
  recordUsage: db.prepare('INSERT INTO usage_events(key_id,model,prompt_tokens,completion_tokens,total_tokens,latency_ms,status_code) VALUES(?,?,?,?,?,?,?)'),
  touchKey: db.prepare('UPDATE api_keys SET last_used_at=CURRENT_TIMESTAMP WHERE id=?'),
  toggleKey: db.prepare('UPDATE api_keys SET enabled=? WHERE id=?'),
  deleteKey: db.prepare('DELETE FROM api_keys WHERE id=?'),
  tokenStats: db.prepare(`SELECT
    COUNT(*) all_requests,
    COALESCE(SUM(total_tokens),0) all_tokens,
    COALESCE(SUM(CASE WHEN created_at >= datetime('now','start of month') THEN total_tokens ELSE 0 END),0) month_tokens,
    COALESCE(SUM(CASE WHEN created_at >= datetime('now','start of day') THEN total_tokens ELSE 0 END),0) today_tokens,
    COALESCE(SUM(CASE WHEN created_at >= datetime('now','start of month') THEN prompt_tokens ELSE 0 END),0) prompt_tokens,
    COALESCE(SUM(CASE WHEN created_at >= datetime('now','start of month') THEN completion_tokens ELSE 0 END),0) completion_tokens,
    COALESCE(SUM(CASE WHEN created_at >= datetime('now','start of month') THEN 1 ELSE 0 END),0) month_requests,
    COALESCE(ROUND(AVG(CASE WHEN created_at >= datetime('now','start of month') THEN total_tokens END)),0) avg_tokens
    FROM usage_events`),
  recent: db.prepare(`SELECT u.created_at,k.name,u.model,u.total_tokens,u.latency_ms,u.status_code
    FROM usage_events u JOIN api_keys k ON k.id=u.key_id ORDER BY u.id DESC LIMIT 50`)
};

module.exports = { db, statements };
