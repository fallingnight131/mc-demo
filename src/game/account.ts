// 系统层 · 账号与云存档同步(BACKEND.md §6)
// 服务端是账号进度的权威副本;localStorage 是本地缓冲(游客则只有本地)。
// 启动对账在进世界之前完成,胜者写入 localStorage —— 游戏内核照常同步读档,
// 不感知网络(不变量 §7.2)。游玩期经 SaveManager.onSaved 防抖推送。
import type { UserInfo } from '../../shared/api';
import { backend } from '../core/backend';

/** 游客键 = 历史键,格式永不改变(不变量 §7.1) */
export const GUEST_KEY = 'mc-demo-save-v1';
/** 游玩期推送防抖 */
const PUSH_DEBOUNCE_MS = 15_000;

interface SyncMeta {
  /** 本地缓冲派生自的云版本 */
  rev: number;
  /** 有未推送的本地改动 */
  pending: boolean;
}

const metaKey = (key: string) => `${key}:meta`;
const conflictKey = (key: string) => `${key}:conflict`;

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 存储不可用:静默(纯内存游玩)
  }
}

function lsRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // 忽略
  }
}

function readMeta(key: string): SyncMeta | null {
  const raw = lsGet(metaKey(key));
  if (!raw) return null;
  try {
    const m = JSON.parse(raw) as SyncMeta;
    if (typeof m.rev === 'number' && typeof m.pending === 'boolean') return m;
  } catch {
    // 坏 meta 当不存在
  }
  return null;
}

function writeMeta(key: string, meta: SyncMeta): void {
  lsSet(metaKey(key), JSON.stringify(meta));
}

export class Account {
  readonly user: UserInfo | null;
  readonly storageKey: string;
  /** 启动对账检出冲突(本机旧改动已备份、采用云端),进游戏后提示一次 */
  conflictNotice = false;
  /** 游玩期推送撞上更新的云版本(另一设备),由 main 接 toast */
  onConflict: (() => void) | null = null;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private pushing = false;

  private constructor(user: UserInfo | null) {
    this.user = user;
    this.storageKey = user ? `${GUEST_KEY}:u${user.id}` : GUEST_KEY;
  }

  /**
   * 启动引导:探测会话 → 登录态则与云端对账,把胜者写入本地缓冲。
   * `?test` 默认游客且零网络(不变量 §7.5),账号链路 e2e 用 `?test&account=1`。
   */
  static async boot(): Promise<Account> {
    const params = new URLSearchParams(location.search);
    const skipNetwork =
      params.has('guest') || (params.has('test') && !params.has('account'));
    if (skipNetwork) return new Account(null);
    const user = await backend.me(1500);
    const acc = new Account(user);
    if (user) await acc.reconcile();
    return acc;
  }

  /** 启动对账(BACKEND.md §6):云无档→绑定本地;同 rev+pending→快进推送;
   *  云更新→云为准(本地 pending 则备份并标记冲突) */
  private async reconcile(): Promise<void> {
    const key = this.storageKey;
    const meta = readMeta(key);
    const res = await backend.getSave();
    if (res.kind === 'offline') return; // 本地模式游玩,pending 由之后的推送重试

    if (res.kind === 'none') {
      // 云端无档:优先本地用户缓冲;否则把游客进度绑定到账号(游客升级路径)
      let local = lsGet(key);
      if (!local) {
        const guest = lsGet(GUEST_KEY);
        if (guest) {
          lsSet(key, guest);
          local = guest;
        }
      }
      if (local) {
        const r = await backend.putSave(0, JSON.parse(local));
        if (r.kind === 'ok') writeMeta(key, { rev: r.rev, pending: false });
        // conflict(两设备赛跑首传)/offline:留给下次启动或游玩期推送处理
      }
      return;
    }

    const cloud = res.info;
    if (meta && cloud.rev === meta.rev) {
      if (meta.pending) {
        // 云没动、本机有未推的改动:快进推送
        const local = lsGet(key);
        if (local) {
          const r = await backend.putSave(meta.rev, JSON.parse(local));
          if (r.kind === 'ok') {
            writeMeta(key, { rev: r.rev, pending: false });
            return;
          }
        }
      } else {
        return; // 与云等价,本地即最新
      }
    }
    // 云端更新(或本地无 meta/快进失败):云为准;本机未推的改动备份后告知
    if (meta?.pending && lsGet(key)) {
      lsSet(conflictKey(key), lsGet(key)!);
      this.conflictNotice = true;
    }
    lsSet(key, JSON.stringify(cloud.payload));
    writeMeta(key, { rev: cloud.rev, pending: false });
  }

  /** SaveManager 落盘后的钩子:标记待推送并防抖(游客直接忽略) */
  onLocalSaved(_json: string): void {
    if (!this.user) return;
    const meta = readMeta(this.storageKey) ?? { rev: 0, pending: false };
    writeMeta(this.storageKey, { rev: meta.rev, pending: true });
    if (this.pushTimer !== null) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => void this.push(), PUSH_DEBOUNCE_MS);
  }

  /** 立即冲刷(页面隐藏/关闭/登出/e2e);keepalive 让请求在卸载后仍完成 */
  async flushNow(keepalive = false): Promise<void> {
    if (this.pushTimer !== null) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
    await this.push(keepalive);
  }

  private async push(keepalive = false): Promise<void> {
    if (!this.user || this.pushing) return;
    const key = this.storageKey;
    const meta = readMeta(key);
    if (!meta?.pending) return;
    const local = lsGet(key);
    if (!local) return;
    this.pushing = true;
    try {
      const r = await backend.putSave(meta.rev, JSON.parse(local), keepalive);
      if (r.kind === 'ok') {
        writeMeta(key, { rev: r.rev, pending: false });
      } else if (r.kind === 'conflict') {
        // 另一设备推了更新的版本:游玩中不热切换世界,提示后留到下次启动对账
        this.onConflict?.();
      }
      // offline / error:保持 pending,等下次防抖或冲刷重试
    } finally {
      this.pushing = false;
    }
  }

  /** 清档重开:清本地缓冲(含 meta/冲突备份),登录态同时删云档 */
  async clearSave(): Promise<void> {
    lsRemove(metaKey(this.storageKey));
    lsRemove(conflictKey(this.storageKey));
    if (this.user) await backend.deleteSave();
  }
}

// —— 模块单例(boot.ts 装配,main.ts 同步取用)——
let current: Account | null = null;

export function initAccount(acc: Account): void {
  current = acc;
}

export function getAccount(): Account {
  if (!current) throw new Error('Account 未初始化:入口必须经 src/boot.ts');
  return current;
}
