import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

const dataDir = process.env.DEVART_DATA ?? path.resolve('data');
if (dataDir !== ':memory:') mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(dataDir === ':memory:' ? ':memory:' : path.join(dataDir, 'devart.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
  password_hash TEXT NOT NULL, theme TEXT NOT NULL DEFAULT 'light', created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, allowed_domain TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS team_members (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL, PRIMARY KEY (team_id, user_id));
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE, name TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL, owner_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL, private INTEGER NOT NULL DEFAULT 0, link_access TEXT NOT NULL DEFAULT 'none',
  share_token TEXT NOT NULL UNIQUE, ystate BLOB, doc TEXT NOT NULL DEFAULT '', canvas TEXT NOT NULL DEFAULT '[]',
  map TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);
CREATE INDEX IF NOT EXISTS files_team ON files(team_id, deleted_at, updated_at);
CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY, file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE, name TEXT,
  doc TEXT NOT NULL, canvas TEXT NOT NULL, map TEXT NOT NULL DEFAULT '', author_id TEXT, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS versions_file ON versions(file_id, created_at);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY, file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES comments(id) ON DELETE CASCADE, author_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL, anchor TEXT, resolved INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, last_used INTEGER);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY, team_id TEXT NOT NULL, user_id TEXT, action TEXT NOT NULL, target TEXT, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS audit_team ON audit_logs(team_id, created_at);
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE, kind TEXT NOT NULL, name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '', doc TEXT NOT NULL, canvas TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS presets (
  id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE, name TEXT NOT NULL, style TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE, name TEXT NOT NULL, mime TEXT NOT NULL,
  data BLOB NOT NULL, is_icon INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS embeds (
  token TEXT PRIMARY KEY, file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE, element_id TEXT, theme TEXT, created_at INTEGER NOT NULL);
`);

export const newId = () => randomBytes(10).toString('base64url');
export const newToken = (bytes = 24) => randomBytes(bytes).toString('base64url');

type Row = Record<string, any>;
export const one = (sql: string, ...args: any[]) => db.prepare(sql).get(...args) as Row | undefined;
export const all = (sql: string, ...args: any[]) => db.prepare(sql).all(...args) as Row[];
export const run = (sql: string, ...args: any[]) => db.prepare(sql).run(...args);

export function audit(teamId: string, userId: string | null, action: string, target?: string) {
  run('INSERT INTO audit_logs (id, team_id, user_id, action, target, created_at) VALUES (?,?,?,?,?,?)', newId(), teamId, userId, action, target ?? null, Date.now());
}
