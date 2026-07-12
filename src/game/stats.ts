// 系统层 · 属性表(ARCHITECTURE.md §3.8b)
// 一切改写玩家数值的来源(盔甲/饰品,未来:药水 buff/套装加成)聚合成一张
// StatSheet;Player 物理、combat、interact 只读聚合结果,不认具体装备。
// 纯逻辑模块:无 DOM / Three.js,可裸测。

export interface StatSheet {
  /** 伤害减免:实际伤害 = max(1, dmg - defense/2)(泰拉公式) */
  defense: number;
  maxHp: number;
  /** 移动速度乘数(加成累加:1 + Σ) */
  moveSpeed: number;
  /** 跳跃力乘数 */
  jumpBoost: number;
  /** 挖掘速度乘数 */
  miningSpeed: number;
  /** 近战伤害乘数 */
  meleeDamage: number;
  /** 空中额外跳跃次数(云朵瓶式) */
  extraJumps: number;
  /** 摔落免疫(幸运马蹄铁式) */
  noFallDamage: boolean;
}

/** 饰品/套装能提供的加成(数值字段为"加成量",聚合时累加) */
export interface StatMods {
  defense: number;
  maxHp: number;
  moveSpeed: number; // +0.25 = 快 25%
  jumpBoost: number;
  miningSpeed: number;
  meleeDamage: number;
  extraJumps: number;
  noFallDamage: boolean;
}

export const BASE_STATS: StatSheet = Object.freeze({
  defense: 0,
  maxHp: 10,
  moveSpeed: 1,
  jumpBoost: 1,
  miningSpeed: 1,
  meleeDamage: 1,
  extraJumps: 0,
  noFallDamage: false,
});

/** 聚合:基础值 + 各来源加成(数值累加,布尔取或) */
export function computeStats(sources: Array<Partial<StatMods>>): StatSheet {
  const out: StatSheet = { ...BASE_STATS };
  for (const s of sources) {
    out.defense += s.defense ?? 0;
    out.maxHp += s.maxHp ?? 0;
    out.moveSpeed += s.moveSpeed ?? 0;
    out.jumpBoost += s.jumpBoost ?? 0;
    out.miningSpeed += s.miningSpeed ?? 0;
    out.meleeDamage += s.meleeDamage ?? 0;
    out.extraJumps += s.extraJumps ?? 0;
    out.noFallDamage = out.noFallDamage || s.noFallDamage === true;
  }
  return out;
}

/** 泰拉防御公式:减免一半防御值,至少造成 1 点 */
export function applyDefense(dmg: number, defense: number): number {
  return Math.max(1, Math.ceil(dmg - defense / 2));
}
