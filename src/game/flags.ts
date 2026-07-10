// 系统层 · 世界进度旗标(见 ARCHITECTURE.md §3.2)
// 一切世界进度(boss 是否击败、世界事件、NPC 解锁)都存这里,随存档保存。
// 命名约定:'boss.eyeOfCthulhu.defeated' / 'event.bloodMoon.count' / 'npc.guide.unlocked'
import type { EventBus } from '../core/events';
import type { SaveSection } from '../core/save';

export type FlagValue = number | boolean;

export class Flags implements SaveSection {
  private readonly map = new Map<string, FlagValue>();
  /** 有未落盘的改动(SaveManager 周期存档据此触发) */
  onDirty: (() => void) | null = null;

  constructor(private readonly events?: EventBus) {}

  get(key: string): FlagValue | undefined {
    return this.map.get(key);
  }

  getBool(key: string): boolean {
    return this.map.get(key) === true;
  }

  getNum(key: string): number {
    const v = this.map.get(key);
    return typeof v === 'number' ? v : 0;
  }

  set(key: string, value: FlagValue): void {
    if (this.map.get(key) === value) return;
    this.map.set(key, value);
    this.onDirty?.();
    this.events?.emit('flagChanged', { key, value });
  }

  /** 计数旗标 +n(默认 +1) */
  increment(key: string, n = 1): number {
    const next = this.getNum(key) + n;
    this.set(key, next);
    return next;
  }

  save(): unknown {
    return [...this.map.entries()];
  }

  load(data: unknown): void {
    this.map.clear();
    if (!Array.isArray(data)) return;
    for (const e of data) {
      if (
        Array.isArray(e) &&
        e.length === 2 &&
        typeof e[0] === 'string' &&
        (typeof e[1] === 'number' || typeof e[1] === 'boolean')
      ) {
        this.map.set(e[0], e[1]);
      }
    }
  }
}
