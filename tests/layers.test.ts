import { describe, expect, it } from 'vitest';
import { Block } from '../src/blocks';
import {
  LAVA_LEVEL,
  LAYER_CAVERN_TOP,
  LAYER_HELL_TOP,
  WORLD_HEIGHT,
} from '../src/config';
import { Generator } from '../src/worldgen';

const CS = 16;
const idx = (lx: number, y: number, lz: number) => (y * CS + lz) * CS + lx;

describe('Terraria 3D 垂直分层', () => {
  const gen = new Generator(1337);
  const chunks: Array<{ cx: number; cz: number; data: Uint8Array }> = [];
  for (let cx = -3; cx <= 3; cx += 2) {
    for (let cz = -3; cz <= 3; cz += 2) {
      chunks.push({ cx, cz, data: gen.generateChunk(cx, cz) });
    }
  }

  it('洞穴层空气充沛(慷慨互联的洞穴网络)', () => {
    let air = 0;
    let tot = 0;
    for (const { data } of chunks) {
      for (let lz = 0; lz < CS; lz++) {
        for (let lx = 0; lx < CS; lx++) {
          for (let y = LAYER_HELL_TOP + 2; y < LAYER_CAVERN_TOP; y++) {
            tot++;
            if (data[idx(lx, y, lz)] === Block.Air) air++;
          }
        }
      }
    }
    const ratio = air / tot;
    expect(ratio).toBeGreaterThan(0.07);
    expect(ratio).toBeLessThan(0.35);
  });

  it('洞穴不破坏地表(表层 3 格完好)', () => {
    for (const { cx, cz, data } of chunks) {
      for (let lz = 0; lz < CS; lz += 5) {
        for (let lx = 0; lx < CS; lx += 5) {
          const h = gen.heightAt(cx * CS + lx, cz * CS + lz);
          for (let y = Math.max(0, h - 2); y <= h; y++) {
            expect(data[idx(lx, y, lz)], `(${lx},${y},${lz})`).not.toBe(Block.Air);
          }
        }
      }
    }
  });

  it('地狱加高:各区域岩浆液面高低不一,灰烬地面与地狱石矿,顶板隔离洞穴层', () => {
    let lava = 0;
    let ash = 0;
    let hellstone = 0;
    let roof = 0;
    let roofTot = 0;
    const lavaTops = new Set<number>();
    for (const { data } of chunks) {
      for (let lz = 0; lz < CS; lz++) {
        for (let lx = 0; lx < CS; lx++) {
          let top = -1;
          for (let y = 1; y < LAYER_HELL_TOP; y++) {
            const id = data[idx(lx, y, lz)];
            if (id === Block.Lava) {
              lava++;
              top = y;
              expect(y).toBeLessThanOrEqual(LAVA_LEVEL + 7); // 岩浆液面按区域上下浮动
            }
            if (id === Block.Ash) ash++;
            if (id === Block.Hellstone) hellstone++;
            if (y >= LAYER_HELL_TOP - 3) {
              roofTot++;
              if (id !== Block.Air && id !== Block.Lava) roof++;
            }
          }
          if (top >= 0) lavaTops.add(top);
        }
      }
    }
    expect(lava).toBeGreaterThan(200);
    expect(ash).toBeGreaterThan(80);
    expect(hellstone).toBeGreaterThan(20);
    expect(lavaTops.size).toBeGreaterThan(2); // 液面高低不一(地形错落 → 岩浆池有高差)
    expect(roof / roofTot).toBeGreaterThan(0.9); // 顶板基本完整
  });

  it('世界高度加深,山峰不越安全上限', () => {
    expect(WORLD_HEIGHT).toBe(224);
    for (let x = -300; x <= 300; x += 25) {
      for (let z = -300; z <= 300; z += 25) {
        expect(gen.heightAt(x, z)).toBeLessThanOrEqual(WORLD_HEIGHT - 40);
      }
    }
  });
});
