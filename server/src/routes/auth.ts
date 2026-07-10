// 路由:注册 / 登录 / 登出 / 会话查询(BACKEND.md §5)
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { DatabaseSync } from 'node:sqlite';
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  USERNAME_RE,
  type AuthBody,
  type UserInfo,
} from '../../../shared/api.ts';
import {
  createSession,
  deleteSession,
  getSession,
  hashPassword,
  verifyPassword,
  SESSION_TTL_MS,
} from '../auth.ts';
import type { RateLimiter } from '../ratelimit.ts';

export const COOKIE_NAME = 'sid';

export interface AuthEnv {
  Variables: { clientKey: string };
}

function parseAuthBody(body: unknown): AuthBody | null {
  if (!body || typeof body !== 'object') return null;
  const { username, password } = body as Record<string, unknown>;
  if (typeof username !== 'string' || typeof password !== 'string') return null;
  if (!USERNAME_RE.test(username)) return null;
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) return null;
  return { username, password };
}

export function authRoutes(db: DatabaseSync, limiter: RateLimiter, secure: boolean): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();

  const setSessionCookie = (c: Context, token: string): void => {
    setCookie(c, COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
      secure,
    });
  };

  app.post('/register', async (c) => {
    if (!limiter.hit(`auth:${c.get('clientKey')}`)) {
      return c.json({ error: 'rate_limited' }, 429);
    }
    const body = parseAuthBody(await c.req.json().catch(() => null));
    if (!body) return c.json({ error: 'invalid' }, 400);
    const exists = db
      .prepare('SELECT id FROM users WHERE username = ?')
      .get(body.username) as { id: number } | undefined;
    if (exists) return c.json({ error: 'taken' }, 409);
    const pass = await hashPassword(body.password);
    let userId: number;
    try {
      const r = db
        .prepare('INSERT INTO users (username, pass, created_at) VALUES (?, ?, ?)')
        .run(body.username, pass, Date.now());
      userId = Number(r.lastInsertRowid);
    } catch {
      return c.json({ error: 'taken' }, 409); // 并发注册撞唯一索引
    }
    setSessionCookie(c, createSession(db, userId));
    const user: UserInfo = { id: userId, username: body.username };
    return c.json({ user }, 201);
  });

  app.post('/login', async (c) => {
    if (!limiter.hit(`auth:${c.get('clientKey')}`)) {
      return c.json({ error: 'rate_limited' }, 429);
    }
    const body = parseAuthBody(await c.req.json().catch(() => null));
    if (!body) return c.json({ error: 'invalid' }, 400);
    const row = db
      .prepare('SELECT id, username, pass FROM users WHERE username = ?')
      .get(body.username) as { id: number; username: string; pass: string } | undefined;
    if (!row || !(await verifyPassword(body.password, row.pass))) {
      return c.json({ error: 'bad_credentials' }, 401);
    }
    setSessionCookie(c, createSession(db, row.id));
    const user: UserInfo = { id: row.id, username: row.username };
    return c.json({ user });
  });

  app.post('/logout', (c) => {
    deleteSession(db, getCookie(c, COOKIE_NAME));
    deleteCookie(c, COOKIE_NAME, { path: '/' });
    return c.body(null, 204);
  });

  app.get('/me', (c) => {
    const token = getCookie(c, COOKIE_NAME);
    const s = getSession(db, token);
    if (!s) return c.json({ error: 'unauthorized' }, 401);
    if (s.renewed && token) setSessionCookie(c, token); // 滑动续期:同令牌重发 Cookie
    const user: UserInfo = { id: s.id, username: s.username };
    return c.json({ user });
  });

  return app;
}
