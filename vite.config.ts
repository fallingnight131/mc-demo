import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
  },
  server: {
    // 账号/云存档 API(BACKEND.md §3):开发走代理到 server(8787);
    // server 不在时游客模式照常游玩(boot 短超时转本地)
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
});
