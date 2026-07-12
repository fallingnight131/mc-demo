// 系统层 · 世界事件(ARCHITECTURE.md §3.8c):黄昏掷骰触发、黎明结束、
// 召唤/调试入口;生效期间把修饰推给刷怪(倍率)与氛围(雾色),
// 广播事件总线 + flags 计数,活动事件随存档恢复。血月是参考实现。
import { WORLD_EVENTS, type WorldEventDef } from '../content/events';
import type { EventBus } from '../core/events';
import type { SaveManager } from '../core/save';
import type { DayNightState } from '../daynight';
import type { Flags } from './flags';

export interface EventModTargets {
  /** 刷怪修饰(Mobs.spawnRateMul/spawnCapMul) */
  setSpawnTuning(rateMul: number, capMul: number): void;
  /** 氛围修饰(ambience.eventFogTint) */
  setFogTint(tint: { color: number; strength: number } | null): void;
  /** 公告 */
  toast(msg: string): void;
}

export class WorldEvents {
  private activeId: string | null = null;
  private wasNight = false;
  /** 触发掷骰(测试可注入确定性随机) */
  rng: () => number = Math.random;

  constructor(
    private readonly targets: EventModTargets,
    private readonly events: EventBus,
    private readonly flags: Flags,
    private readonly save: SaveManager,
  ) {}

  get active(): string | null {
    return this.activeId;
  }

  activeDef(): WorldEventDef | null {
    return this.activeId ? (WORLD_EVENTS[this.activeId] ?? null) : null;
  }

  /** 每帧:黄昏沿掷骰触发,黎明沿结束(以 starAlpha 0.5 为夜界) */
  update(dn: DayNightState): void {
    const night = dn.starAlpha > 0.5;
    if (night && !this.wasNight) {
      // 黄昏:夜幕落下的一刻
      if (!this.activeId) {
        for (const def of Object.values(WORLD_EVENTS)) {
          if (def.nightChance > 0 && this.rng() < def.nightChance) {
            this.start(def.id);
            break;
          }
        }
      }
    } else if (!night && this.wasNight) {
      // 黎明
      const def = this.activeDef();
      if (def?.endsAtDawn) this.stop();
    }
    this.wasNight = night;
  }

  /** 触发事件(黄昏掷骰 / 召唤物 / 调试);重复触发忽略 */
  start(id: string): void {
    const def = WORLD_EVENTS[id];
    if (!def || this.activeId === id) return;
    if (this.activeId) this.stop(); // 互斥:先结束旧事件
    this.activeId = id;
    this.applyMods(def);
    this.targets.toast(def.startMsg);
    this.flags.increment(`event.${id}.count`);
    this.events.emit('worldEventStarted', { id });
    this.save.markDirty();
  }

  stop(): void {
    const def = this.activeDef();
    if (!def) return;
    this.activeId = null;
    this.applyMods(null);
    this.targets.toast(def.endMsg);
    this.events.emit('worldEventEnded', { id: def.id });
    this.save.markDirty();
  }

  private applyMods(def: WorldEventDef | null): void {
    this.targets.setSpawnTuning(def?.spawnRateMul ?? 1, def?.spawnCapMul ?? 1);
    this.targets.setFogTint(def?.fogTint ?? null);
  }

  /** 存档分节 'worldEvent':活动事件跨会话恢复(血月读档后继续) */
  registerSave(): void {
    this.save.register('worldEvent', {
      save: () => this.activeId,
      load: (d) => {
        if (typeof d === 'string' && WORLD_EVENTS[d]) {
          this.activeId = d;
          this.applyMods(WORLD_EVENTS[d]);
          this.wasNight = true; // 事件存在 = 存档时是夜里,黎明沿正常结束
        }
      },
    });
  }
}
