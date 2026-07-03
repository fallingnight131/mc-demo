import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { Block, flowId, isWater, waterLevel } from '../src/blocks';
import { World } from '../src/world';

function makeWorld(): World {
  const mat = new THREE.MeshBasicMaterial();
  const w = new World(mat, mat, 1337);
  w.warmup(0, 0);
  return w;
}

const PLATFORM_Y = 60; // 高于附近地形,保证测试环境可控

/** 在 y=60 搭一块 9x9 石台,中心可放水源 */
function buildPlatform(world: World): void {
  for (let dx = -4; dx <= 4; dx++) {
    for (let dz = -4; dz <= 4; dz++) {
      world.setBlock(dx, PLATFORM_Y, dz, Block.Stone);
    }
  }
}

describe('water ids', () => {
  it('等级与 id 互转', () => {
    expect(waterLevel(Block.Water)).toBe(4);
    for (let l = 1; l <= 4; l++) {
      expect(waterLevel(flowId(l))).toBe(l);
      expect(isWater(flowId(l))).toBe(true);
    }
    expect(isWater(Block.Stone)).toBe(false);
    expect(isWater(Block.Air)).toBe(false);
  });
});

describe('water flow', () => {
  let world: World;
  beforeEach(() => {
    world = makeWorld();
    buildPlatform(world);
  });

  it('水源向四周扩散并按距离衰减', () => {
    world.setBlock(0, PLATFORM_Y + 1, 0, Block.Water);
    for (let i = 0; i < 8; i++) world.water.tick();

    expect(world.getBlock(0, PLATFORM_Y + 1, 0)).toBe(Block.Water); // 源不变
    expect(waterLevel(world.getBlock(1, PLATFORM_Y + 1, 0))).toBe(3);
    expect(waterLevel(world.getBlock(2, PLATFORM_Y + 1, 0))).toBe(2);
    expect(waterLevel(world.getBlock(3, PLATFORM_Y + 1, 0))).toBe(1);
    expect(world.getBlock(4, PLATFORM_Y + 1, 0)).toBe(Block.Air); // 超出范围
    // 对角线按曼哈顿距离衰减
    expect(waterLevel(world.getBlock(1, PLATFORM_Y + 1, 1))).toBe(2);
  });

  it('移除水源后流水退去', () => {
    world.setBlock(0, PLATFORM_Y + 1, 0, Block.Water);
    for (let i = 0; i < 8; i++) world.water.tick();
    world.setBlock(0, PLATFORM_Y + 1, 0, Block.Air);
    for (let i = 0; i < 12; i++) world.water.tick();

    for (let dx = -4; dx <= 4; dx++) {
      for (let dz = -4; dz <= 4; dz++) {
        expect(isWater(world.getBlock(dx, PLATFORM_Y + 1, dz))).toBe(false);
      }
    }
  });

  it('挖开平台后水往下灌成瀑布', () => {
    world.setBlock(0, PLATFORM_Y + 1, 0, Block.Water);
    for (let i = 0; i < 8; i++) world.water.tick();
    // 在等级 2 流水脚下挖洞
    world.setBlock(2, PLATFORM_Y, 0, Block.Air);
    for (let i = 0; i < 12; i++) world.water.tick();

    expect(isWater(world.getBlock(2, PLATFORM_Y, 0))).toBe(true); // 洞口被灌满
    expect(isWater(world.getBlock(2, PLATFORM_Y - 4, 0))).toBe(true); // 持续下落
  });

  it('放置方块覆盖流水,水从该格消失', () => {
    world.setBlock(0, PLATFORM_Y + 1, 0, Block.Water);
    for (let i = 0; i < 8; i++) world.water.tick();
    world.setBlock(1, PLATFORM_Y + 1, 0, Block.Plank);
    expect(world.getBlock(1, PLATFORM_Y + 1, 0)).toBe(Block.Plank);
    for (let i = 0; i < 6; i++) world.water.tick();
    // 绕路距离变化:(2,1) 经 (1,1) 曼哈顿距离 3 → 等级 1;
    // (2,0) 绕行距离 4 → 断流退去
    expect(waterLevel(world.getBlock(2, PLATFORM_Y + 1, 1))).toBe(1);
    expect(world.getBlock(2, PLATFORM_Y + 1, 0)).toBe(Block.Air);
  });

  it('瀑布落地后登记持续溅水采样点', () => {
    world.setBlock(0, PLATFORM_Y + 1, 0, Block.Water);
    for (let i = 0; i < 8; i++) world.water.tick();
    world.setBlock(2, PLATFORM_Y, 0, Block.Air); // 开洞成瀑布
    // 落到地表(约 y=29)需要 ~35 tick
    for (let i = 0; i < 45; i++) world.water.tick();
    const cells = world.water.sampleLandings(3, 2, 0, 60);
    expect(cells.length).toBeGreaterThan(0);
    for (const [x, y, z] of cells) {
      expect(isWater(world.getBlock(x, y, z))).toBe(true);
      expect(isWater(world.getBlock(x, y + 1, z))).toBe(true); // 上有来水
    }
    // 流水氛围声:站在瀑布旁能查到很近的落点,远处则查不到
    const near = world.water.nearestLandingDist(2.5, 30, 0.5);
    expect(near).toBeLessThan(6);
    expect(world.water.nearestLandingDist(500, 30, 500)).toBeGreaterThan(400);
  });

  it('静水不产生活跃格子', () => {
    for (let i = 0; i < 4; i++) world.water.tick();
    expect(world.water.activeCount).toBe(0);
  });
});
