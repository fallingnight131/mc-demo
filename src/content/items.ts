// 内容层 · 统一物品注册表(见 ARCHITECTURE.md §3.4)
// 方块物品与工具/武器共用一个 id 空间(方块 0..99,物品 100+)与这一张表。
// 规则代码(战斗/挖掘/交互/图鉴/HUD)只认这里的字段,不认具体 id ——
// 加一件武器 = 注册一条数据 + 图标,战斗系统零改动。
// 纯数据模块:不触碰 DOM / Three.js,可在 vitest 裸测;图标解析见 itemIcon()。
import { baseBlock, Block, BLOCK_DEFS, PLACEABLE } from '../blocks';
import { materialOf } from '../sound';
import { Tool, TOOL_DEFS } from '../tools';

export type ItemKind = 'block' | 'tool' | 'weapon';

/** 挥动时发射的弹幕(泰拉之刃剑气、未来的远程/魔法武器) */
export interface ProjectileSpawn {
  speed: number;
  /** 存活时长(秒) */
  life: number;
  damage: number;
  /** 重力系数(0 = 直线飞行) */
  gravity: number;
  /** 穿透:命中后不消失 */
  pierce?: boolean;
}

export interface WeaponDef {
  /** 基础伤害(徒手 = 1) */
  damage: number;
  /** 水平击退速度 */
  knockback: number;
  /** 竖直击飞速度 */
  knockUp: number;
  /** 攻击间隔(秒,0 = 不节流) */
  cooldown: number;
  /** 近战扇形角(弧度):有值则一次挥砍命中弧内多个目标;无值为单体射线 */
  swingArc?: number;
  /** 挥动时发射弹幕 */
  projectile?: ProjectileSpawn;
  /** 手持时不能挖掘(剑类) */
  noMining?: boolean;
}

export interface ItemDef {
  id: number;
  name: string;
  kind: ItemKind;
  /** 图鉴/悬浮提示说明 */
  desc: string;
  /** kind=block:对应的可放置方块 id */
  block?: number;
  /** 挖掘加速类别(镐对石类 / 斧对木类) */
  toolClass?: 'pickaxe' | 'axe';
  /** 挖掘倍速 */
  toolPower?: number;
  /** kind=weapon 必填 */
  weapon?: WeaponDef;
}

/** 徒手(以及一切非武器物品)的战斗参数 */
export const FIST: WeaponDef = { damage: 1, knockback: 6, knockUp: 4.4, cooldown: 0 };

const defs = new Map<number, ItemDef>();

function describeBlock(id: number): string {
  const curated: Record<number, string> = {
    [Block.TNT]: '点燃后爆炸,可连锁',
    [Block.Chest]: '点开:宝箱↕背包双栏存取',
    [Block.Torch]: '光源 14 · 照亮洞穴',
    [Block.Glowstone]: '光源 15 · 永久明亮',
    [Block.Obsidian]: '极硬 · 抗爆',
    [Block.Pumpkin]: '放置时脸朝玩家',
    [Block.DungeonBrick]: '地牢建材 · 坚硬',
    [Block.Cloud]: '天空岛材质',
  };
  if (curated[id]) return curated[id];
  const def = BLOCK_DEFS[id];
  if (def.shape === 'cross') return '装饰植被 · 可穿行采除';
  if (def.gravity) return '受重力 · 会坠落';
  const matName =
    { stone: '石类', wood: '木类', soft: '软质', sand: '沙质', glass: '玻璃', snow: '雪' }[
      materialOf(id)
    ] ?? '';
  return `${matName} · 硬度 ${def.hardness}`;
}

// 全部具名方块入表(含宝箱等不可放置方块,图鉴/掉落物需要它们的名字与说明)
for (let id = 1; id < BLOCK_DEFS.length; id++) {
  const b = BLOCK_DEFS[id];
  if (b.hardness === Infinity && !b.solid) continue; // 水/岩浆等流体不是物品
  defs.set(id, {
    id,
    name: b.name,
    kind: 'block',
    desc: describeBlock(id),
    block: id,
  });
}

// 工具与武器(id ≥ 100;新武器照 ARCHITECTURE.md §4.2 在这里注册)
defs.set(Tool.FlintSteel, {
  id: Tool.FlintSteel,
  name: TOOL_DEFS[Tool.FlintSteel].name,
  kind: 'tool',
  desc: TOOL_DEFS[Tool.FlintSteel].hint,
});
defs.set(Tool.Pickaxe, {
  id: Tool.Pickaxe,
  name: TOOL_DEFS[Tool.Pickaxe].name,
  kind: 'tool',
  desc: TOOL_DEFS[Tool.Pickaxe].hint,
  toolClass: 'pickaxe',
  toolPower: 3,
});
defs.set(Tool.Axe, {
  id: Tool.Axe,
  name: TOOL_DEFS[Tool.Axe].name,
  kind: 'tool',
  desc: TOOL_DEFS[Tool.Axe].hint,
  toolClass: 'axe',
  toolPower: 3,
});
defs.set(Tool.Sword, {
  id: Tool.Sword,
  name: TOOL_DEFS[Tool.Sword].name,
  kind: 'weapon',
  desc: TOOL_DEFS[Tool.Sword].hint,
  weapon: { damage: 2, knockback: 6, knockUp: 4.4, cooldown: 0, noMining: true },
});

export function itemDef(id: number): ItemDef | undefined {
  return defs.get(id);
}

export function itemName(id: number): string {
  if (id === Block.Air) return '空手';
  return defs.get(id)?.name ?? `#${id}`;
}

export function itemDesc(id: number): string {
  return defs.get(id)?.desc ?? '';
}

/** 手持物品的战斗参数(非武器一律按徒手) */
export function weaponOf(id: number): WeaponDef {
  return defs.get(id)?.weapon ?? FIST;
}

/** 手持该物品能否挖掘(剑类武器不能) */
export function canMineWith(id: number): boolean {
  return !defs.get(id)?.weapon?.noMining;
}

/** 手持物品对指定方块的挖掘倍速(镐→石类 / 斧→木类) */
export function miningBoost(itemId: number, blockId: number): number {
  const d = defs.get(itemId);
  if (!d?.toolClass || !d.toolPower) return 1;
  const mat = materialOf(blockId);
  if (d.toolClass === 'pickaxe' && mat === 'stone') return d.toolPower;
  if (d.toolClass === 'axe' && mat === 'wood') return d.toolPower;
  return 1;
}

/** 可放入背包/快捷栏的全部物品 id(可放置方块 + 工具武器) */
export function inventoryItems(): number[] {
  return [...PLACEABLE, ...[...defs.keys()].filter((id) => id >= 100).sort((a, b) => a - b)];
}

/** 创造模式的"全图鉴"目录:全部已注册物品(方块去掉朝向变体 + 工具武器) */
export function catalogItems(): number[] {
  return [...defs.keys()].filter((id) => id >= 100 || baseBlock(id) === id).sort((a, b) => a - b);
}

/** 物品图标(注入 GameTextures 解析;空手为透明图) */
export interface IconSource {
  iconFor(blockId: number): HTMLCanvasElement;
  toolIconFor(toolId: number): HTMLCanvasElement;
}

let blankIcon: HTMLCanvasElement | null = null;

export function itemIcon(tex: IconSource, id: number): HTMLCanvasElement {
  if (id === Block.Air) {
    if (!blankIcon) {
      blankIcon = document.createElement('canvas');
      blankIcon.width = 32;
      blankIcon.height = 32;
    }
    return blankIcon;
  }
  return id >= 100 ? tex.toolIconFor(id) : tex.iconFor(id);
}
