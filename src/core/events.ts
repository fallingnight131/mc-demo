// 核心层 · 类型化事件总线(见 ARCHITECTURE.md §3.1)
// 事件是"已经发生的事实",过去式命名;监听者不得假定彼此的执行顺序。
// 系统间的松耦合通知一律走这里;紧耦合的一对一回调(如 world.onBlockChanged
// 之于 falling)保持原有直连,不为总线而总线。

/** 伤害来源(战斗管线与事件共用) */
export type DamageSource = 'mob' | 'lava' | 'fall' | 'explosion' | 'projectile' | 'debug';

export interface GameEvents {
  /** 方块被破坏(byPlayer=false 为爆炸/水冲等世界原因) */
  blockBroken: { x: number; y: number; z: number; id: number; byPlayer: boolean };
  blockPlaced: { x: number; y: number; z: number; id: number };
  explosion: { x: number; y: number; z: number; radius: number };
  mobDamaged: { kind: string; x: number; y: number; z: number; hp: number; dmg: number };
  /** 生物被击杀:boss 进度、任务、特殊掉落都从这里挂 */
  mobKilled: { kind: string; x: number; y: number; z: number };
  playerDamaged: { dmg: number; hp: number; source: DamageSource };
  playerDied: { source: DamageSource };
  playerRespawned: { x: number; y: number; z: number };
  itemPickedUp: { id: number; count: number };
  /** 合成成功(recipe = 配方稳定 id;成就/任务/图鉴解锁挂这里) */
  itemCrafted: { recipe: string; result: number; count: number };
  chestOpened: { x: number; y: number; z: number };
  /** 世界进度旗标变化(boss 击败/事件解锁,见 game/flags.ts) */
  flagChanged: { key: string; value: number | boolean };
  /** 世界事件开始/结束(血月/南瓜月,见 game/worldevents.ts) */
  worldEventStarted: { id: string };
  worldEventEnded: { id: string };
}

type Handler<K extends keyof GameEvents> = (payload: GameEvents[K]) => void;

export class EventBus {
  private readonly handlers = new Map<keyof GameEvents, Set<Handler<never>>>();

  /** 订阅;返回退订函数 */
  on<K extends keyof GameEvents>(type: K, fn: Handler<K>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn as Handler<never>);
    return () => set.delete(fn as Handler<never>);
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of set) (fn as Handler<K>)(payload);
  }
}
