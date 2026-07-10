// 认证:scrypt 口令哈希 + 服务端不透明会话(库中只存令牌的 sha256,BACKEND.md §5/§7.6)
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

const SCRYPT_N = 16384; // 2^14
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30 天
/** 剩余寿命低于此值时滑动续期 */
const SESSION_RENEW_MS = 15 * 24 * 3600 * 1000;

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

/** 存储格式:scrypt$N$r$p$salt_hex$hash_hex(参数随行,便于将来升级强度) */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[4], 'hex');
  const expect = Buffer.from(parts[5], 'hex');
  const key = await new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      expect.length,
      { N: Number(parts[1]), r: Number(parts[2]), p: Number(parts[3]) },
      (err, k) => (err ? reject(err) : resolve(k)),
    );
  });
  return key.length === expect.length && timingSafeEqual(key, expect);
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface SessionUser {
  id: number;
  username: string;
  /** 会话已滑动续期,应重发 Cookie */
  renewed: boolean;
}

/** 签发会话:返回交给 Cookie 的明文令牌(库中只存哈希) */
export function createSession(db: DatabaseSync, userId: number): string {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
  ).run(sha256(token), userId, now + SESSION_TTL_MS, now);
  return token;
}

/** 校验会话(惰性清理过期 + 滑动续期) */
export function getSession(db: DatabaseSync, token: string | undefined): SessionUser | null {
  if (!token) return null;
  const hash = sha256(token);
  const row = db
    .prepare(
      `SELECT s.expires_at AS expiresAt, u.id AS id, u.username AS username
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    )
    .get(hash) as { expiresAt: number; id: number; username: string } | undefined;
  if (!row) return null;
  const now = Date.now();
  if (row.expiresAt < now) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
    return null;
  }
  let renewed = false;
  if (row.expiresAt - now < SESSION_RENEW_MS) {
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(
      now + SESSION_TTL_MS,
      hash,
    );
    renewed = true;
  }
  return { id: row.id, username: row.username, renewed };
}

export function deleteSession(db: DatabaseSync, token: string | undefined): void {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}
