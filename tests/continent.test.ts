import { describe, expect, it } from 'vitest';
import {
  CONTINENT_RADIUS,
  RANGE_INNER,
  RANGE_OUTER,
  SEA_LEVEL,
  SNOW_LEVEL,
  WORLD_WALL_RADIUS,
} from '../src/config';
import { Generator } from '../src/worldgen';

describe('Terraria 3D 大陆结构', () => {
  const gen = new Generator(1337);

  it('世界中心(出生地)是平缓陆地,不是海也不是高山', () => {
    let maxH = 0;
    let minH = 999;
    for (let r = 0; r <= 60; r += 10) {
      for (let a = 0; a < 12; a++) {
        const h = gen.heightAt(
          Math.round(Math.cos((a / 12) * Math.PI * 2) * r),
          Math.round(Math.sin((a / 12) * Math.PI * 2) * r),
        );
        maxH = Math.max(maxH, h);
        minH = Math.min(minH, h);
      }
    }
    expect(minH).toBeGreaterThan(SEA_LEVEL - 3); // 至多小水洼
    expect(maxH).toBeLessThan(SEA_LEVEL + 21); // 中心无高山
  });

  it('环形山脉带存在:带内有雪峰,且有山口(可通行谷道)', () => {
    const mid = (RANGE_INNER + RANGE_OUTER) / 2;
    let peak = 0;
    let passes = 0;
    for (let a = 0; a < 96; a++) {
      const ang = (a / 96) * Math.PI * 2;
      let ringMax = 0;
      for (let d = mid - 40; d <= mid + 40; d += 10) {
        ringMax = Math.max(
          ringMax,
          gen.heightAt(Math.round(Math.cos(ang) * d), Math.round(Math.sin(ang) * d)),
        );
      }
      peak = Math.max(peak, ringMax);
      if (ringMax < SNOW_LEVEL) passes++; // 该方向无需翻雪山 → 可通行
    }
    expect(peak).toBeGreaterThanOrEqual(SNOW_LEVEL); // 有雪峰
    expect(passes).toBeGreaterThan(4); // 存在多处可通行方向(山口)
    expect(passes).toBeLessThan(88); // 但山脉主体连绵(雪峰占相当比例)
  });

  it('大陆外是海,一直延伸到空气墙', () => {
    for (const d of [CONTINENT_RADIUS + 130, WORLD_WALL_RADIUS - 10]) {
      for (let a = 0; a < 24; a++) {
        const h = gen.heightAt(
          Math.round(Math.cos((a / 24) * Math.PI * 2) * d),
          Math.round(Math.sin((a / 24) * Math.PI * 2) * d),
        );
        expect(h, `d=${d} a=${a}`).toBeLessThan(SEA_LEVEL);
      }
    }
  });

  it('海岸线随噪声起伏,不是完美圆', () => {
    // 在平均海陆交界(基准半径内缩 35)处采样:有的方向是陆地,有的已入海
    const rim = CONTINENT_RADIUS - 35;
    let landCount = 0;
    for (let a = 0; a < 48; a++) {
      const h = gen.heightAt(
        Math.round(Math.cos((a / 48) * Math.PI * 2) * rim),
        Math.round(Math.sin((a / 48) * Math.PI * 2) * rim),
      );
      if (h >= SEA_LEVEL) landCount++;
    }
    expect(landCount).toBeGreaterThan(4);
    expect(landCount).toBeLessThan(44);
  });
});
