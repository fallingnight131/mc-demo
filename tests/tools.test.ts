import { describe, expect, it } from 'vitest';
import { Block, BLOCK_DEFS, PLACEABLE } from '../src/blocks';
import { materialOf } from '../src/sound';
import { isTool, Tool, TOOL_DEFS, TOOL_IDS } from '../src/tools';

describe('工具', () => {
  it('工具 id 空间与方块隔离,定义完整', () => {
    expect(isTool(99)).toBe(false);
    expect(isTool(Tool.FlintSteel)).toBe(true);
    expect(TOOL_IDS.length).toBe(3);
    for (const id of TOOL_IDS) {
      expect(TOOL_DEFS[id].name.length).toBeGreaterThan(0);
      expect(PLACEABLE.includes(id)).toBe(false); // 工具不可作为方块放置
    }
  });

  it('金属块(铁/金/钻石)定义完整且归为石类(镐子可加速)', () => {
    for (const id of [Block.IronBlock, Block.GoldBlock, Block.DiamondBlock]) {
      const def = BLOCK_DEFS[id];
      expect(def.solid).toBe(true);
      expect(def.hardness).toBeGreaterThanOrEqual(2);
      expect(PLACEABLE.includes(id)).toBe(true);
      expect(materialOf(id)).toBe('stone');
    }
  });
});
