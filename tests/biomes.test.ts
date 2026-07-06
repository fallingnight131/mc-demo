import { describe, expect, it } from 'vitest';
import { Block } from '../src/blocks';
import { SEA_LEVEL } from '../src/config';
import { Generator } from '../src/worldgen';

const CS = 16;
const idx = (lx: number, y: number, lz: number) => (y * CS + lz) * CS + lx;

describe('Terraria 3D 生物群系', () => {
  const gen = new Generator(1337);

  /** 在扇区内找一块陆地(群系带有海湾,固定角可能落水) */
  function findLand(biome: string, a0: number, a1: number): { x: number; z: number } {
    for (let a = a0; a < a1; a += 0.05) {
      for (let d = 250; d < 335; d += 8) {
        const x = Math.round(Math.cos(a) * d);
        const z = Math.round(Math.sin(a) * d);
        if (gen.biomeAt(x, z) === biome && gen.heightAt(x, z) > SEA_LEVEL + 2) return { x, z };
      }
    }
    throw new Error(`no land for ${biome}`);
  }

  it('群系按方位分区:中心森林,东南丛林,西侧腐化', () => {
    expect(gen.biomeAt(0, 0)).toBe('forest');
    expect(gen.biomeAt(30, -30)).toBe('forest'); // 出生盆地全森林
    // 两个扇区都存在陆地群系(位置分区而非随机)
    const j = findLand('jungle', 0.85, 1.6);
    const c = findLand('corruption', 3.45, 4.0);
    expect(gen.biomeAt(j.x, j.z)).toBe('jungle');
    expect(gen.biomeAt(c.x, c.z)).toBe('corruption');
    // 两扇区分居大陆两侧
    expect(Math.hypot(j.x - c.x, j.z - c.z)).toBeGreaterThan(250);
  });

  it('丛林树木密度显著高于森林', () => {
    let jungle = 0;
    let forest = 0;
    const jSpot = findLand('jungle', 0.85, 1.6);
    let jungleCells = 0;
    let forestCells = 0;
    for (let dx = -40; dx <= 40; dx++) {
      for (let dz = -40; dz <= 40; dz++) {
        const x = jSpot.x + dx;
        const z = jSpot.z + dz;
        if (gen.biomeAt(x, z) === 'jungle' && gen.heightAt(x, z) > SEA_LEVEL + 1) {
          jungleCells++;
          if (gen.hasTree(x, z)) jungle++;
        }
        if (gen.biomeAt(dx, dz) === 'forest') {
          forestCells++;
          if (gen.hasTree(dx, dz)) forest++;
        }
      }
    }
    // 按格密度:丛林应显著高于森林
    expect(jungle / jungleCells).toBeGreaterThan((forest / forestCells) * 2.5);
  });

  it('腐化区:腐化草地、浅层黑檀石、深谷直插洞穴层', () => {
    // 找一个腐化区块
    const spot = findLand('corruption', 3.45, 4.0);
    const cx = Math.round(spot.x / CS);
    const cz = Math.round(spot.z / CS);
    let corruptGrass = 0;
    let ebon = 0;
    for (const [dx, dz] of [[0, 0], [1, 0], [0, 1]]) {
      const data = gen.generateChunk(cx + dx, cz + dz);
      for (let i = 0; i < data.length; i++) {
        if (data[i] === Block.CorruptGrass) corruptGrass++;
        if (data[i] === Block.EbonStone) ebon++;
      }
    }
    expect(corruptGrass).toBeGreaterThan(50);
    expect(ebon).toBeGreaterThan(200);
    // 深谷存在:腐化环带内找 chasm 列,其地表到 57 全空
    let found = false;
    for (let a = 3.15; a < 4.25 && !found; a += 0.01) {
      for (let d = 255; d < 340 && !found; d += 3) {
        const x = Math.round(Math.cos(a) * d);
        const z = Math.round(Math.sin(a) * d);
        if (gen.chasmAt(x, z) && gen.heightAt(x, z) > SEA_LEVEL + 2) found = true;
      }
    }
    expect(found).toBe(true);
  });

  it('河流:内陆存在低于海平面的水道(山脉流向海)', () => {
    let riverCols = 0;
    for (let a = 0; a < 360; a++) {
      const ang = (a / 360) * Math.PI * 2;
      for (let d = 270; d < 340; d += 5) {
        const x = Math.round(Math.cos(ang) * d);
        const z = Math.round(Math.sin(ang) * d);
        // 内陆水道:自身低于海平面,但 25 格外两侧是陆地
        if (
          gen.heightAt(x, z) <= SEA_LEVEL - 2 &&
          gen.heightAt(Math.round(x + Math.cos(ang + 1.57) * 25), Math.round(z + Math.sin(ang + 1.57) * 25)) > SEA_LEVEL + 1 &&
          gen.heightAt(Math.round(x - Math.cos(ang + 1.57) * 25), Math.round(z - Math.sin(ang + 1.57) * 25)) > SEA_LEVEL + 1
        ) {
          riverCols++;
          break;
        }
      }
    }
    expect(riverCols).toBeGreaterThan(5); // 河道穿过多个方位
    expect(riverCols).toBeLessThan(200); // 但不是遍地是河
  });

  it('丛林区块使用丛林草与丛林树叶', () => {
    const spot = findLand('jungle', 0.85, 1.6);
    const cx = Math.round(spot.x / CS);
    const cz = Math.round(spot.z / CS);
    const data = gen.generateChunk(cx, cz);
    let jg = 0;
    let jl = 0;
    for (let i = 0; i < data.length; i++) {
      if (data[i] === Block.JungleGrass) jg++;
      if (data[i] === Block.JungleLeaves) jl++;
    }
    expect(jg).toBeGreaterThan(30);
    expect(jl).toBeGreaterThan(30);
  });
});
