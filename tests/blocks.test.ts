import { describe, expect, it } from 'vitest';
import { baseBlock, Block, BLOCK_DEFS, PLACEABLE, pumpkinVariant } from '../src/blocks';
import { CHUNK_SIZE } from '../src/config';
import { Generator } from '../src/worldgen';

const CS = CHUNK_SIZE;

describe('blocks', () => {
  it('所有可放置方块定义完整:有六面纹理、参与碰撞、可徒手挖掘', () => {
    for (const id of PLACEABLE) {
      const def = BLOCK_DEFS[id];
      expect(def, `id=${id}`).toBeDefined();
      expect(def.tiles, `${def.name} 纹理`).not.toBeNull();
      expect(def.tiles!.length).toBe(6);
      expect(def.solid, `${def.name} 碰撞`).toBe(true);
      expect(def.hardness).toBeGreaterThan(0);
      expect(Number.isFinite(def.hardness), `${def.name} 可挖掘`).toBe(true);
    }
    expect(new Set(PLACEABLE).size).toBe(PLACEABLE.length);
  });
});

describe('矿石与南瓜生成', () => {
  const gen = new Generator(1337);
  const idx = (lx: number, y: number, lz: number) => (y * CS + lz) * CS + lx;

  it('石头层里生成四种矿石,数量煤>铁>金/钻,且都埋在地表以下', () => {
    const counts: Record<number, number> = {};
    for (let cx = -2; cx < 2; cx++) {
      for (let cz = -2; cz < 2; cz++) {
        const data = gen.generateChunk(cx, cz);
        for (let lz = 0; lz < CS; lz++) {
          for (let lx = 0; lx < CS; lx++) {
            const h = gen.heightAt(cx * CS + lx, cz * CS + lz);
            for (let y = 0; y <= h; y++) {
              const id = data[idx(lx, y, lz)];
              if (
                id === Block.CoalOre ||
                id === Block.IronOre ||
                id === Block.GoldOre ||
                id === Block.DiamondOre
              ) {
                counts[id] = (counts[id] ?? 0) + 1;
                // 矿石只在石头区域(地表 3 格以下)
                expect(y).toBeLessThan(h - 3);
                if (id === Block.DiamondOre) expect(y).toBeLessThanOrEqual(14);
                if (id === Block.GoldOre) expect(y).toBeLessThanOrEqual(22);
                if (id === Block.IronOre) expect(y).toBeLessThanOrEqual(42);
              }
            }
          }
        }
      }
    }
    expect(counts[Block.CoalOre] ?? 0).toBeGreaterThan(20);
    expect(counts[Block.IronOre] ?? 0).toBeGreaterThan(5);
    expect(counts[Block.CoalOre]).toBeGreaterThan(counts[Block.IronOre]);
    expect((counts[Block.GoldOre] ?? 0) + (counts[Block.DiamondOre] ?? 0)).toBeGreaterThan(0);
  });

  it('矿石生成是确定性的:同一区块两次生成一致', () => {
    const a = gen.generateChunk(1, 1);
    const b = gen.generateChunk(1, 1);
    expect(a.length).toBe(b.length);
    let diff = -1;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        diff = i;
        break;
      }
    }
    expect(diff).toBe(-1);
  });

  it('草地上偶有南瓜(含朝向变体),且总在地表上一格', () => {
    let pumpkins = 0;
    for (let cx = -4; cx < 4; cx++) {
      for (let cz = -4; cz < 4; cz++) {
        const data = gen.generateChunk(cx, cz);
        for (let lz = 0; lz < CS; lz++) {
          for (let lx = 0; lx < CS; lx++) {
            const h = gen.heightAt(cx * CS + lx, cz * CS + lz);
            for (let y = 0; y < 64; y++) {
              if (baseBlock(data[idx(lx, y, lz)]) === Block.Pumpkin) {
                pumpkins++;
                expect(y).toBe(h + 1);
                expect(data[idx(lx, y - 1, lz)]).toBe(Block.Grass);
              }
            }
          }
        }
      }
    }
    expect(pumpkins).toBeGreaterThan(0);
  });

  it('南瓜放置朝向:脸始终转向玩家,变体归一化回基础南瓜', () => {
    expect(pumpkinVariant(0)).toBe(Block.Pumpkin); // 面朝 -z 放置 → 脸朝 +z(玩家)
    expect(pumpkinVariant(Math.PI)).toBe(Block.PumpkinN);
    expect(pumpkinVariant(Math.PI / 2)).toBe(Block.PumpkinE);
    expect(pumpkinVariant(-Math.PI / 2)).toBe(Block.PumpkinW);
    for (const v of [Block.Pumpkin, Block.PumpkinE, Block.PumpkinN, Block.PumpkinW]) {
      expect(baseBlock(v)).toBe(Block.Pumpkin);
      expect(BLOCK_DEFS[v].tiles).not.toBeNull();
    }
    expect(baseBlock(Block.Stone)).toBe(Block.Stone);
  });
});
