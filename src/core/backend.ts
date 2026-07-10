// 核心层 · 后端 API 客户端(BACKEND.md §5)。
// ⚠ 不变量 §7.2:游戏内核不感知网络 —— 只允许 boot / game/account / ui/account 引用本模块。
import type { ApiError, SaveInfo, UserInfo } from '../../shared/api';

export type AuthResult = { ok: true; user: UserInfo } | { ok: false; error: ApiError | 'network' };
export type SaveGetResult = { kind: 'ok'; info: SaveInfo } | { kind: 'none' } | { kind: 'offline' };
export type SavePutResult =
  | { kind: 'ok'; rev: number }
  | { kind: 'conflict'; rev: number }
  | { kind: 'offline' }
  | { kind: 'error'; error: ApiError };

async function request(path: string, init: RequestInit = {}, timeoutMs = 4000): Promise<Response | null> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(path, { credentials: 'same-origin', signal: ctl.signal, ...init });
    clearTimeout(timer);
    return res;
  } catch {
    return null; // 离线 / 超时 / 服务器不在 —— 调用方转本地模式
  }
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

async function authCall(path: string, username: string, password: string): Promise<AuthResult> {
  const res = await request(path, json({ username, password }));
  if (!res) return { ok: false, error: 'network' };
  const body = (await res.json().catch(() => null)) as { user?: UserInfo; error?: ApiError } | null;
  if (res.ok && body?.user) return { ok: true, user: body.user };
  return { ok: false, error: body?.error ?? 'invalid' };
}

export const backend = {
  /** 会话探测(启动引导用,短超时):未登录/离线 → null */
  async me(timeoutMs = 1500): Promise<UserInfo | null> {
    const res = await request('/api/auth/me', {}, timeoutMs);
    if (!res || !res.ok) return null;
    const body = (await res.json().catch(() => null)) as { user?: UserInfo } | null;
    return body?.user ?? null;
  },

  register: (u: string, p: string) => authCall('/api/auth/register', u, p),
  login: (u: string, p: string) => authCall('/api/auth/login', u, p),

  async logout(): Promise<void> {
    await request('/api/auth/logout', { method: 'POST' });
  },

  async getSave(slot = 0): Promise<SaveGetResult> {
    const res = await request(`/api/saves/${slot}`);
    if (!res) return { kind: 'offline' };
    if (res.status === 404) return { kind: 'none' };
    if (!res.ok) return { kind: 'offline' }; // 401(会话中途失效)等:按离线处理,不动本地进度
    const info = (await res.json().catch(() => null)) as SaveInfo | null;
    return info ? { kind: 'ok', info } : { kind: 'offline' };
  },

  async putSave(baseRev: number, payload: unknown, keepalive = false, slot = 0): Promise<SavePutResult> {
    const res = await request(`/api/saves/${slot}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseRev, payload }),
      keepalive,
    });
    if (!res) return { kind: 'offline' };
    const body = (await res.json().catch(() => null)) as { rev?: number; error?: ApiError } | null;
    if (res.ok && typeof body?.rev === 'number') return { kind: 'ok', rev: body.rev };
    if (res.status === 409) return { kind: 'conflict', rev: body?.rev ?? 0 };
    return { kind: 'error', error: body?.error ?? 'invalid' };
  },

  async deleteSave(slot = 0): Promise<boolean> {
    const res = await request(`/api/saves/${slot}`, { method: 'DELETE' });
    return res !== null && (res.ok || res.status === 404);
  },
};
