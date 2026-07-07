import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { Block, flowId, isWater, waterLevel } from '../src/blocks';
import { World } from '../src/world';

function makeWorld(): World {
  const mat = new THREE.MeshBasicMaterial();
  const w = new World(mat, mat, 1337);
  w.warmup(5, 5); // 平台区(80,80)所在区块:远离中央世界树的树冠
  return w;
}

const PLATFORM_Y = 195; // 高于附近地形(新地表最高 184),保证测试环境可控
// 平台原点:世界树立于 (0,0) 且树冠拢到 y≈212,测试场地挪到旁边的开阔地
const OX = 80;
const OZ = 80;

/** 搭一块 9x9 石台,中心可放水源 */
function buildPlatform(world: World): void {
  for (let dx = -4; dx <= 4; dx++) {
    for (let dz = -4; dz <= 4; dz++) {
      world.setBlock(OX + dx, PLATFORM_Y, OZ + dz, Block.Stone);
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
    world.setBlock(OX, PLATFORM_Y + 1, OZ, Block.Water);
    for (let i = 0; i < 8; i++) world.water.tick();

    expect(world.getBlock(OX, PLATFORM_Y + 1, OZ)).toBe(Block.Water); // 源不变
    expect(waterLevel(world.getBlock(OX + 1, PLATFORM_Y + 1, OZ))).toBe(3);
    expect(waterLevel(world.getBlock(OX + 2, PLATFORM_Y + 1, OZ))).toBe(2);
    expect(waterLevel(world.getBlock(OX + 3, PLATFORM_Y + 1, OZ))).toBe(1);
    expect(world.getBlock(OX + 4, PLATFORM_Y + 1, OZ)).toBe(Block.Air); // 超出范围
    // 对角线按曼哈顿距离衰减
    expect(waterLevel(world.getBlock(OX + 1, PLATFORM_Y + 1, OZ + 1))).toBe(2);
  });

  it('移除水源后流水退去', () => {
    world.setBlock(OX, PLATFORM_Y + 1, OZ, Block.Water);
    for (let i = 0; i < 8; i++) world.water.tick();
    world.setBlock(OX, PLATFORM_Y + 1, OZ, Block.Air);
    for (let i = 0; i < 12; i++) world.water.tick();

    for (let dx = -4; dx <= 4; dx++) {
      for (let dz = -4; dz <= 4; dz++) {
        expect(isWater(world.getBlock(OX + dx, PLATFORM_Y + 1, OZ + dz))).toBe(false);
      }
    }
  });

  it('挖开平台后水往下灌成瀑布', () => {
    world.setBlock(OX, PLATFORM_Y + 1, OZ, Block.Water);
    for (let i = 0; i < 8; i++) world.water.tick();
    // 在等级 2 流水脚下挖洞
    world.setBlock(OX + 2, PLATFORM_Y, OZ, Block.Air);
    for (let i = 0; i < 12; i++) world.water.tick();

    expect(isWater(world.getBlock(OX + 2, PLATFORM_Y, OZ))).toBe(true); // 洞口被灌满
    expect(isWater(world.getBlock(OX + 2, PLATFORM_Y - 4, OZ))).toBe(true); // 持续下落
  });

  it('放置方块覆盖流水,水从该格消失', () => {
    world.setBlock(OX, PLATFORM_Y + 1, OZ, Block.Water);
    for (let i = 0; i < 8; i++) world.water.tick();
    world.setBlock(OX + 1, PLATFORM_Y + 1, OZ, Block.Plank);
    expect(world.getBlock(OX + 1, PLATFORM_Y + 1, OZ)).toBe(Block.Plank);
    for (let i = 0; i < 6; i++) world.water.tick();
    // 绕路距离变化:(2,1) 经 (1,1) 曼哈顿距离 3 → 等级 1;
    // (2,0) 绕行距离 4 → 断流退去
    expect(waterLevel(world.getBlock(OX + 2, PLATFORM_Y + 1, OZ + 1))).toBe(1);
    expect(world.getBlock(OX + 2, PLATFORM_Y + 1, OZ)).toBe(Block.Air);
  });

  it('瀑布落地后登记持续溅水采样点', () => {
    world.setBlock(OX, PLATFORM_Y + 1, OZ, Block.Water);
    for (let i = 0; i < 8; i++) world.water.tick();
    world.setBlock(OX + 2, PLATFORM_Y, OZ, Block.Air); // 开洞成瀑布
    // 从平台(195)落到地表(约 131)需要 ~65 tick
    for (let i = 0; i < 85; i++) world.water.tick();
    const cells = world.water.sampleLandings(3, OX + 2, OZ, 90);
    expect(cells.length).toBeGreaterThan(0);
    for (const [x, y, z] of cells) {
      expect(isWater(world.getBlock(x, y, z))).toBe(true);
      expect(isWater(world.getBlock(x, y + 1, z))).toBe(true); // 上有来水
    }
    // 流水氛围声:站在瀑布落点旁能查到很近的落点,远处则查不到
    const near = world.water.nearestLandingDist(cells[0][0] + 0.5, cells[0][1], cells[0][2] + 0.5);
    expect(near).toBeLessThan(6);
    expect(world.water.nearestLandingDist(500, 30, 500)).toBeGreaterThan(400);
  });

  it('静水不产生活跃格子', () => {
    for (let i = 0; i < 4; i++) world.water.tick();
    expect(world.water.activeCount).toBe(0);
  });
});
