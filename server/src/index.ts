// 入口:开发/生产单进程 —— /api/* + (生产)托管 dist/ 静态文件(BACKEND.md §3)
// 运行:node --disable-warning=ExperimentalWarning src/index.ts(Node ≥ 23 原生 TS)
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { openDb } from './db.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

const PORT = Number(process.env.PORT ?? 8787);
const DB_PATH = process.env.DB_PATH ?? join(repoRoot, 'server', 'data', 'game.db');

const db = openDb(DB_PATH);
const app = createApp({ db, secureCookies: process.env.SECURE_COOKIES === '1' });

// 生产:同源托管前端构建产物(先 vite build);开发走 Vite 代理,不经这里
const dist = join(repoRoot, 'dist');
if (existsSync(dist)) {
  app.use('/*', serveStatic({ root: relative(process.cwd(), dist) }));
}

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[mc-demo-server] listening on http://localhost:${info.port} (db: ${DB_PATH})`);
});
