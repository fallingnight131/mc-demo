// 数据层:node:sqlite(内置,零依赖)+ PRAGMA user_version 增量迁移(BACKEND.md §4)
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** 按序追加,只增不改 —— 每项跑一次,user_version 记录进度 */
const MIGRATIONS: string[] = [
  `CREATE TABLE users (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     username   TEXT NOT NULL UNIQUE COLLATE NOCASE,
     pass       TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     user_id    INTEGER NOT NULL REFERENCES users(id),
     expires_at INTEGER NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX idx_sessions_expiry ON sessions(expires_at);
   CREATE TABLE saves (
     user_id    INTEGER NOT NULL REFERENCES users(id),
     slot       INTEGER NOT NULL DEFAULT 0,
     rev        INTEGER NOT NULL,
     payload    TEXT NOT NULL,
     updated_at INTEGER NOT NULL,
     PRIMARY KEY (user_id, slot)
   );`,
];

export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  // 启动时清一次过期会话(游玩期靠校验时的惰性清理)
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  return db;
}
