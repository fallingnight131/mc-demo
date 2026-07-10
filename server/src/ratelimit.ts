// 限流:内存固定窗口(单实例够用;多实例换 Redis,见 BACKEND.md §8)
interface Window {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly windows = new Map<string, Window>();
  private readonly limit: number;
  private readonly windowMs: number;

  // 注意:server 由 Node 原生跑 TS(strip-only),不能用构造器参数属性(BACKEND.md §2)
  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** 记一次;超限返回 false */
  hit(key: string): boolean {
    const now = Date.now();
    const w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    w.count++;
    if (w.count > this.limit) return false;
    return true;
  }

  /** 测试用 */
  reset(): void {
    this.windows.clear();
  }
}
