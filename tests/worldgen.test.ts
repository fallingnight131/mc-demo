import { describe, expect, it } from 'vitest';
import { Block } from '../src/blocks';
import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from '../src/config';
import { hash2, Noise2D } from '../src/noise';
import { Generator } from '../src/worldgen';

const CS = CHUNK_SIZE;
const idx = (lx: number, y: number, lz: number) => (y * CS + lz) * CS + lx;

describe('noise', () => {
  it('hash2 确定且在 [0,1)', () => {
    for (let i = -50; i < 50; i++) {
      const v = hash2(i, i * 7 - 3, 12345);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(hash2(i, i * 7 - 3, 12345)).toBe(v);
    }
  });

  it('值噪声范围约 [-1,1] 且确定', () => {
    const n = new Noise2D(42);
    for (let i = 0; i < 200; i++) {
      const x = i * 0.37 - 30;
      const y = i * 0.91 + 5;
      const v = n.fbm(x, y, 4);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
      expect(n.fbm(x, y, 4)).toBe(v);
    }
  });
});

describe('worldgen', () => {
  const gen = new Generator(1337);

  it('区块生成确定性', () => {
    const a = gen.generateChunk(3, -2);
    const b = gen.generateChunk(3, -2);
    expect(a.length).toBe(b.length);
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) diff++;
    }
    expect(diff).toBe(0);
  });

  it('底层是基岩,高度在范围内', () => {
    const data = gen.generateChunk(0, 0);
    for (let lz = 0; lz < CS; lz++) {
      for (let lx = 0; lx < CS; lx++) {
        expect(data[idx(lx, 0, lz)]).toBe(Block.Bedrock);
      }
    }
    const h = gen.heightAt(5, 5);
    expect(h).toBeGreaterThan(0);
    expect(h).toBeLessThan(WORLD_HEIGHT);
  });

  it('水只出现在海平面及以下', () => {
    for (let cx = -2; cx <= 2; cx++) {
      const data = gen.generateChunk(cx, 7);
      for (let y = SEA_LEVEL + 1; y < WORLD_HEIGHT; y++) {
        for (let i = 0; i < CS * CS; i++) {
          const lz = Math.floor(i / CS);
          const lx = i % CS;
          expect(data[idx(lx, y, lz)]).not.toBe(Block.Water);
        }
      }
    }
  });

  it('出生点在海平面以上', () => {
    const s = gen.findSpawn();
    expect(s.y).toBeGreaterThan(SEA_LEVEL);
  });
});
