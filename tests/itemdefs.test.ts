// 统一物品注册表:武器/工具数据通道(ARCHITECTURE.md §3.4)
import { describe, expect, it } from 'vitest';
import { Block, BLOCK_DEFS, PLACEABLE } from '../src/blocks';
import {
  canMineWith,
  FIST,
  inventoryItems,
  itemDef,
  itemName,
  miningBoost,
  weaponOf,
} from '../src/content/items';
import { Tool, TOOL_IDS } from '../src/tools';

describe('item registry', () => {
  it('全部可放置方块与全部工具都有注册项(名字与方块表一致)', () => {
    for (const id of PLACEABLE) {
      expect(itemDef(id)?.name, `block #${id}`).toBe(BLOCK_DEFS[id].name);
      expect(itemDef(id)?.kind).toBe('block');
    }
    for (const id of TOOL_IDS) {
      expect(itemDef(id), `tool #${id}`).toBeDefined();
    }
    expect(itemName(Block.Air)).toBe('空手');
  });

  it('武器数据:剑双倍伤害且不能挖掘;徒手/工具按 FIST 结算', () => {
    expect(weaponOf(Tool.Sword).damage).toBe(2);
    expect(canMineWith(Tool.Sword)).toBe(false);
    expect(weaponOf(Tool.Pickaxe)).toBe(FIST);
    expect(weaponOf(Block.Air)).toBe(FIST);
    expect(canMineWith(Tool.Pickaxe)).toBe(true);
    expect(canMineWith(Block.Air)).toBe(true);
  });

  it('挖掘倍速:镐→石类 3 倍,斧→木类 3 倍,错配为 1', () => {
    expect(miningBoost(Tool.Pickaxe, Block.Stone)).toBe(3);
    expect(miningBoost(Tool.Pickaxe, Block.Obsidian)).toBe(3);
    expect(miningBoost(Tool.Axe, Block.Log)).toBe(3);
    expect(miningBoost(Tool.Axe, Block.Chest)).toBe(3);
    expect(miningBoost(Tool.Pickaxe, Block.Log)).toBe(1);
    expect(miningBoost(Tool.Axe, Block.Stone)).toBe(1);
    expect(miningBoost(Tool.Sword, Block.Stone)).toBe(1);
    expect(miningBoost(Block.Air, Block.Stone)).toBe(1);
  });

  it('背包物品全集 = 可放置方块 + 工具武器 + 装备饰品;流体不是物品', () => {
    const items = inventoryItems();
    expect(items).toEqual([...PLACEABLE, ...TOOL_IDS, 110, 111, 112, 120, 121, 122]);
    expect(itemDef(Block.Water)).toBeUndefined();
    expect(itemDef(Block.Lava)).toBeUndefined();
  });
});
