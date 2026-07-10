// 路由:云存档拉取/推送(乐观并发 rev,BACKEND.md §5/§6)
// 载荷是 SaveManager 分节 JSON,服务端只管归属/版本/大小,不解释内部结构(§7.3)。
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { DatabaseSync } from 'node:sqlite';
import {
  SAVE_PAYLOAD_LIMIT,
  type SaveInfo,
  type SavePut,
  type SavePutOk,
} from '../../../shared/api.ts';
import { getSession, type SessionUser } from '../auth.ts';
import type { RateLimiter } from '../ratelimit.ts';
import { COOKIE_NAME } from './auth.ts';

export interface SavesEnv {
  Variables: { clientKey: string; user: SessionUser };
}

/** 存档位:当前只用 0,协议按 0..7 预留多角色/多世界(BACKEND.md §8.B) */
const MAX_SLOT = 7;

export function savesRoutes(db: DatabaseSync, limiter: RateLimiter): Hono<SavesEnv> {
  const app = new Hono<SavesEnv>();

  // 认证中间件:无有效会话一律 401
  app.use('*', async (c, next) => {
    const s = getSession(db, getCookie(c, COOKIE_NAME));
    if (!s) return c.json({ error: 'unauthorized' }, 401);
    c.set('user', s);
    await next();
  });

  const parseSlot = (raw: string): number | null => {
    const slot = Number(raw);
    return Number.isInteger(slot) && slot >= 0 && slot <= MAX_SLOT ? slot : null;
  };

  app.get('/:slot', (c) => {
    const slot = parseSlot(c.req.param('slot'));
    if (slot === null) return c.json({ error: 'invalid' }, 400);
    const row = db
      .prepare('SELECT rev, payload, updated_at AS updatedAt FROM saves WHERE user_id = ? AND slot = ?')
      .get(c.get('user').id, slot) as { rev: number; payload: string; updatedAt: number } | undefined;
    if (!row) return c.json({ error: 'no_save' }, 404);
    const info: SaveInfo = { rev: row.rev, updatedAt: row.updatedAt, payload: JSON.parse(row.payload) };
    return c.json(info);
  });

  app.put('/:slot', async (c) => {
    if (!limiter.hit(`saves:${c.get('clientKey')}`)) {
      return c.json({ error: 'rate_limited' }, 429);
    }
    const slot = parseSlot(c.req.param('slot'));
    if (slot === null) return c.json({ error: 'invalid' }, 400);
    // 粗筛超大请求(精确校验在序列化后)
    const declared = Number(c.req.header('content-length') ?? 0);
    if (declared > SAVE_PAYLOAD_LIMIT * 1.25) return c.json({ error: 'too_large' }, 413);
    const body = (await c.req.json().catch(() => null)) as SavePut | null;
    if (!body || typeof body.baseRev !== 'number' || body.payload === undefined) {
      return c.json({ error: 'invalid' }, 400);
    }
    const payload = JSON.stringify(body.payload);
    if (payload.length > SAVE_PAYLOAD_LIMIT) return c.json({ error: 'too_large' }, 413);

    const userId = c.get('user').id;
    const now = Date.now();
    const cur = db
      .prepare('SELECT rev FROM saves WHERE user_id = ? AND slot = ?')
      .get(userId, slot) as { rev: number } | undefined;
    if (!cur) {
      if (body.baseRev !== 0) return c.json({ error: 'conflict', rev: 0 }, 409);
      db.prepare(
        'INSERT INTO saves (user_id, slot, rev, payload, updated_at) VALUES (?, ?, 1, ?, ?)',
      ).run(userId, slot, payload, now);
      return c.json({ rev: 1 } satisfies SavePutOk);
    }
    if (cur.rev !== body.baseRev) return c.json({ error: 'conflict', rev: cur.rev }, 409);
    const next = cur.rev + 1;
    db.prepare(
      'UPDATE saves SET rev = ?, payload = ?, updated_at = ? WHERE user_id = ? AND slot = ?',
    ).run(next, payload, now, userId, slot);
    return c.json({ rev: next } satisfies SavePutOk);
  });

  // 清档重开:删除云端存档(玩家显式操作,无需版本校验)
  app.delete('/:slot', (c) => {
    const slot = parseSlot(c.req.param('slot'));
    if (slot === null) return c.json({ error: 'invalid' }, 400);
    db.prepare('DELETE FROM saves WHERE user_id = ? AND slot = ?').run(c.get('user').id, slot);
    return c.body(null, 204);
  });

  return app;
}
