// 组装 Hono 应用(可测工厂:测试经 app.request() 直连,不监听端口)
import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono } from 'hono';
import type { DatabaseSync } from 'node:sqlite';
import { RateLimiter } from './ratelimit.ts';
import { authRoutes } from './routes/auth.ts';
import { savesRoutes } from './routes/saves.ts';

export interface AppOptions {
  db: DatabaseSync;
  /** 生产(HTTPS)下 Cookie 加 Secure */
  secureCookies?: boolean;
  /** 测试可注入更小的限流窗口 */
  authLimiter?: RateLimiter;
  savesLimiter?: RateLimiter;
}

interface Env {
  Variables: { clientKey: string };
}

export function createApp(opts: AppOptions): Hono<Env> {
  const authLimiter = opts.authLimiter ?? new RateLimiter(20, 10 * 60 * 1000);
  const savesLimiter = opts.savesLimiter ?? new RateLimiter(60, 60 * 1000);
  const app = new Hono<Env>();

  // 限流键:同源部署下直接取 socket 地址;测试环境(app.request 无 socket)用固定键
  app.use('/api/*', async (c, next) => {
    let key = 'local';
    try {
      key = getConnInfo(c).remote.address ?? 'local';
    } catch {
      key = 'test';
    }
    c.set('clientKey', key);
    await next();
  });

  app.get('/api/health', (c) => c.json({ ok: true }));
  app.route('/api/auth', authRoutes(opts.db, authLimiter, opts.secureCookies === true));
  app.route('/api/saves', savesRoutes(opts.db, savesLimiter));
  app.notFound((c) =>
    c.req.path.startsWith('/api/')
      ? c.json({ error: 'not_found' }, 404)
      : c.text('Not Found', 404),
  );
  return app;
}
