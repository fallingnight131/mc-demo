// 内容层 · 世界事件注册表(ARCHITECTURE.md §3.8c / §4.8)
// 一个事件 = 一条声明式定义 + 生效期间的修饰集;血月是参考实现。
// 南瓜月式波次事件:在此加 waves/score 字段 + worldevents 读进度(见路线图 A2)。

export interface WorldEventDef {
  id: string;
  name: string;
  /** 黄昏触发概率(0..1;0 = 仅召唤物/调试触发) */
  nightChance: number;
  /** 黎明自动结束 */
  endsAtDawn: boolean;
  /** 氛围修饰:雾色向该色调靠拢 */
  fogTint?: { color: number; strength: number };
  /** 刷怪频率倍数 */
  spawnRateMul: number;
  /** 刷怪上限倍数 */
  spawnCapMul: number;
  startMsg: string;
  endMsg: string;
}

export const WORLD_EVENTS: Record<string, WorldEventDef> = {
  bloodMoon: {
    id: 'bloodMoon',
    name: '血月',
    nightChance: 1 / 9, // 泰拉:每晚 1/9
    endsAtDawn: true,
    fogTint: { color: 0xb03030, strength: 0.5 },
    spawnRateMul: 3,
    spawnCapMul: 2.5,
    startMsg: '血月升起了……夜里的怪物躁动起来!',
    endMsg: '血月落下了。',
  },
};
