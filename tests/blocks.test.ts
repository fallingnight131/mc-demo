import { describe, expect, it } from 'vitest';
import { baseBlock, Block, BLOCK_DEFS, PLACEABLE, pumpkinVariant } from '../src/blocks';
import { CHUNK_SIZE, SEA_LEVEL, SNOW_LEVEL } from '../src/config';
import { Generator } from '../src/worldgen';

const CS = CHUNK_SIZE;

describe('blocks', () => {
  it('所有可放置方块定义完整:有六面纹理、参与碰撞、可徒手挖掘', () => {
    for (const id of PLACEABLE) {
      const def = BLOCK_DEFS[id];
      expect(def, `id=${id}`).toBeDefined();
      expect(def.tiles, `${def.name} 纹理`).not.toBeNull();
      expect(def.tiles!.length).toBe(6);
      // 十字面片方块(火把)不参与碰撞,其余可放置方块必须有碰撞
      expect(def.solid || def.shape === 'cross', `${def.name} 碰撞`).toBe(true);
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
                if (id === Block.DiamondOre) expect(y).toBeLessThanOrEqual(52);
                if (id === Block.GoldOre) expect(y).toBeLessThanOrEqual(76);
                if (id === Block.IronOre) expect(y).toBeLessThanOrEqual(112);
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

  it('南瓜成簇(聚落)而非满地均匀撒点', () => {
    // 直接检验 hasPumpkin 的分布形态:大范围扫描找出所有南瓜点
    const pts: Array<[number, number]> = [];
    for (let x = -220; x < 220; x++) {
      for (let z = -220; z < 220; z++) {
        if (gen.hasPumpkin(x, z)) pts.push([x, z]);
      }
    }
    expect(pts.length).toBeGreaterThan(8); // 世界里确有南瓜
    // 聚落特征:绝大多数南瓜近旁(≤4 格)还有别的南瓜——均匀撒点不会如此成簇
    let clustered = 0;
    for (const [x, z] of pts) {
      if (pts.some(([x2, z2]) => (x2 !== x || z2 !== z) && Math.abs(x2 - x) <= 4 && Math.abs(z2 - z) <= 4)) {
        clustered++;
      }
    }
    expect(clustered / pts.length).toBeGreaterThan(0.7);
    // 落点集中在少数 40 格聚落格,每格聚集多个南瓜
    const cells = new Set(pts.map(([x, z]) => `${Math.floor(x / 40)},${Math.floor(z / 40)}`));
    expect(cells.size).toBeLessThan(pts.length / 3);
  });

  it('地表植被依环境生长:森林青草花、丛林蕨、腐化荆棘各就其位', () => {
    const PLANT_GRASS: Record<number, number> = {
      [Block.TallGrass]: Block.Grass,
      [Block.Flower]: Block.Grass,
      [Block.JungleFern]: Block.JungleGrass,
      [Block.CorruptThorn]: Block.CorruptGrass,
    };
    const found: Record<number, number> = {
      [Block.TallGrass]: 0,
      [Block.Flower]: 0,
      [Block.JungleFern]: 0,
      [Block.CorruptThorn]: 0,
    };
    // 定位某群系一处陆地,扫描其 3×3 区块统计植被
    const scanBiome = (want: 'forest' | 'jungle' | 'corruption') => {
      let cx0 = 0;
      let cz0 = 0;
      let ok = false;
      for (let r = 7; r < 40 && !ok; r++) {
        for (let a = 0; a < 24 && !ok; a++) {
          const x = Math.round(Math.cos((a / 24) * Math.PI * 2) * r * 16);
          const z = Math.round(Math.sin((a / 24) * Math.PI * 2) * r * 16);
          const hh = gen.heightAt(x, z);
          if (gen.biomeAt(x, z) === want && hh > SEA_LEVEL + 2 && hh < SNOW_LEVEL - 2) {
            cx0 = Math.floor(x / CS);
            cz0 = Math.floor(z / CS);
            ok = true;
          }
        }
      }
      expect(ok, `找到 ${want} 陆地`).toBe(true);
      for (let cx = cx0 - 1; cx <= cx0 + 1; cx++) {
        for (let cz = cz0 - 1; cz <= cz0 + 1; cz++) {
          const data = gen.generateChunk(cx, cz);
          for (let lz = 0; lz < CS; lz++) {
            for (let lx = 0; lx < CS; lx++) {
              const h = gen.heightAt(cx * CS + lx, cz * CS + lz);
              for (let y = 125; y < 205; y++) {
                const id = data[idx(lx, y, lz)];
                if (PLANT_GRASS[id] !== undefined) {
                  found[id]++;
                  expect(y, '植被在地表上一格').toBe(h + 1);
                  expect(data[idx(lx, y - 1, lz)], '植被立于对应群系草地').toBe(PLANT_GRASS[id]);
                  expect(BLOCK_DEFS[id].shape, '植被为十字面片').toBe('cross');
                  expect(BLOCK_DEFS[id].solid, '植被不碰撞').toBe(false);
                }
              }
            }
          }
        }
      }
    };
    scanBiome('forest');
    scanBiome('jungle');
    scanBiome('corruption');
    expect(found[Block.TallGrass], '森林有青草').toBeGreaterThan(0);
    expect(found[Block.JungleFern], '丛林有蕨').toBeGreaterThan(0);
    expect(found[Block.CorruptThorn], '腐化有荆棘').toBeGreaterThan(0);
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
