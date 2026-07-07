// 工具/武器定义(非方块物品):id 从 100 起,与方块 id 空间隔开。
// 打火石点燃 TNT、镐子挖石类 3 倍速、剑对生物双倍伤害、斧头砍木类 3 倍速。

export const Tool = {
  FlintSteel: 100,
  Pickaxe: 101,
  Sword: 102,
  Axe: 103,
} as const;

export interface ToolDef {
  name: string;
  /** 说明(背包悬浮提示用) */
  hint: string;
}

export const TOOL_DEFS: Record<number, ToolDef> = {
  [Tool.FlintSteel]: { name: '打火石', hint: '点按 TNT 点燃' },
  [Tool.Pickaxe]: { name: '镐子', hint: '挖石类方块 3 倍速' },
  [Tool.Sword]: { name: '剑', hint: '对生物双倍伤害' },
  [Tool.Axe]: { name: '斧头', hint: '砍木类方块 3 倍速' },
};

export const TOOL_IDS: number[] = Object.keys(TOOL_DEFS).map(Number);

export function isTool(id: number): boolean {
  return id >= 100;
}
