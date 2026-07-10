// server 单测:认证/会话/云存档乐观并发/限流/载荷上限(BACKEND.md §5/§6)
// 全部经 app.request() 直连 + :memory: 数据库,不监听端口。
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';
import { RateLimiter } from '../src/ratelimit.ts';

function makeApp(opts: { authLimit?: number } = {}) {
  const db = openDb(':memory:');
  const app = createApp({
    db,
    authLimiter: new RateLimiter(opts.authLimit ?? 100, 60_000),
    savesLimiter: new RateLimiter(100, 60_000),
  });
  return { app, db };
}

/** 从 Set-Cookie 提取会话 Cookie(sid=...) */
function sidOf(res: Response): string {
  const raw = res.headers.get('set-cookie') ?? '';
  const m = raw.match(/sid=([^;]+)/);
  expect(m, 'set-cookie 应包含 sid').toBeTruthy();
  return `sid=${m![1]}`;
}

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

async function register(app: ReturnType<typeof makeApp>['app'], name = 'player1') {
  const res = await app.request('/api/auth/register', json({ username: name, password: 'secret123' }));
  expect(res.status).toBe(201);
  return { cookie: sidOf(res), user: ((await res.json()) as { user: { id: number } }).user };
}

describe('auth', () => {
  it('注册 → me;重名 409;非法输入 400', async () => {
    const { app } = makeApp();
    const { cookie } = await register(app, 'Alice_玩家');
    const me = await app.request('/api/auth/me', { headers: { cookie } });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { user: { username: string } }).user.username).toBe('Alice_玩家');

    // 用户名大小写不敏感唯一
    const dup = await app.request('/api/auth/register', json({ username: 'alice_玩家', password: 'secret123' }));
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as { error: string }).error).toBe('taken');

    for (const bad of [
      { username: 'ab', password: 'secret123' }, // 太短
      { username: 'ok_name', password: 'short' }, // 口令太短
      { username: 'bad name!', password: 'secret123' }, // 非法字符
      { nope: 1 },
    ]) {
      const res = await app.request('/api/auth/register', json(bad));
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
  });

  it('登录成功/口令错误;登出后会话失效', async () => {
    const { app } = makeApp();
    await register(app, 'bob');
    const wrong = await app.request('/api/auth/login', json({ username: 'bob', password: 'wrongpass' }));
    expect(wrong.status).toBe(401);

    const ok = await app.request('/api/auth/login', json({ username: 'bob', password: 'secret123' }));
    expect(ok.status).toBe(200);
    const cookie = sidOf(ok);

    const out = await app.request('/api/auth/logout', { method: 'POST', headers: { cookie } });
    expect(out.status).toBe(204);
    const me = await app.request('/api/auth/me', { headers: { cookie } });
    expect(me.status).toBe(401); // 服务端会话已撤销,旧 Cookie 无效
  });

  it('无 Cookie 的 me 与 saves 都是 401', async () => {
    const { app } = makeApp();
    expect((await app.request('/api/auth/me')).status).toBe(401);
    expect((await app.request('/api/saves/0')).status).toBe(401);
  });

  it('认证限流:超过阈值返回 429', async () => {
    const { app } = makeApp({ authLimit: 3 });
    for (let i = 0; i < 3; i++) {
      await app.request('/api/auth/login', json({ username: 'nobody', password: 'whatever1' }));
    }
    const res = await app.request('/api/auth/login', json({ username: 'nobody', password: 'whatever1' }));
    expect(res.status).toBe(429);
  });

  it('库中不存明文:口令为 scrypt 串,会话存哈希', async () => {
    const { app, db } = makeApp();
    const { cookie } = await register(app, 'carol');
    const u = db.prepare('SELECT pass FROM users WHERE username = ?').get('carol') as { pass: string };
    expect(u.pass.startsWith('scrypt$')).toBe(true);
    expect(u.pass).not.toContain('secret123');
    const token = cookie.slice(4);
    const s = db.prepare('SELECT token_hash FROM sessions').get() as { token_hash: string };
    expect(s.token_hash).not.toBe(token); // 存的是 sha256,不是明文令牌
    expect(s.token_hash).toHaveLength(64);
  });
});

describe('saves(乐观并发)', () => {
  it('拉空 404 → 首传 baseRev=0 得 rev1 → 拉回同载荷 → 递增推进', async () => {
    const { app } = makeApp();
    const { cookie } = await register(app);
    expect((await app.request('/api/saves/0', { headers: { cookie } })).status).toBe(404);

    const payload = { edits: { '0,0': [[1, 2]] }, hp: 9, time: 0.5 };
    const put1 = await app.request('/api/saves/0', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ baseRev: 0, payload }),
    });
    expect(put1.status).toBe(200);
    expect(((await put1.json()) as { rev: number }).rev).toBe(1);

    const get = await app.request('/api/saves/0', { headers: { cookie } });
    const info = (await get.json()) as { rev: number; payload: unknown; updatedAt: number };
    expect(info.rev).toBe(1);
    expect(info.payload).toEqual(payload);
    expect(info.updatedAt).toBeGreaterThan(0);

    const put2 = await app.request('/api/saves/0', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ baseRev: 1, payload: { hp: 10 } }),
    });
    expect(((await put2.json()) as { rev: number }).rev).toBe(2);
  });

  it('陈旧 baseRev 得 409 + 当前 rev(另一设备先推的情形)', async () => {
    const { app } = makeApp();
    const { cookie } = await register(app);
    const put = (baseRev: number) =>
      app.request('/api/saves/0', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ baseRev, payload: { v: baseRev } }),
      });
    await put(0); // rev 1
    await put(1); // rev 2
    const stale = await put(1); // 基于 rev1 的旧客户端
    expect(stale.status).toBe(409);
    expect((await stale.json()) as object).toEqual({ error: 'conflict', rev: 2 });
    // 首传冲突:云已有档时 baseRev=0 也 409
    const freshDevice = await put(0);
    expect(freshDevice.status).toBe(409);
  });

  it('账号间与存档位间互相隔离', async () => {
    const { app } = makeApp();
    const a = await register(app, 'user_a');
    const b = await register(app, 'user_b');
    await app.request('/api/saves/0', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: a.cookie },
      body: JSON.stringify({ baseRev: 0, payload: { who: 'a' } }),
    });
    // b 看不到 a 的存档
    expect((await app.request('/api/saves/0', { headers: { cookie: b.cookie } })).status).toBe(404);
    // a 的槽 1 独立于槽 0
    expect((await app.request('/api/saves/1', { headers: { cookie: a.cookie } })).status).toBe(404);
    // 非法槽位
    expect((await app.request('/api/saves/99', { headers: { cookie: a.cookie } })).status).toBe(400);
  });

  it('超限载荷 413', async () => {
    const { app } = makeApp();
    const { cookie } = await register(app);
    const big = 'x'.repeat(2 * 1024 * 1024 + 16);
    const res = await app.request('/api/saves/0', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ baseRev: 0, payload: big }),
    });
    expect(res.status).toBe(413);
  });
});
