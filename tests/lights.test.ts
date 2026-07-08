import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { Block } from '../src/blocks';
import { Lights } from '../src/lights';
import { World } from '../src/world';

describe('块光照', () => {
  let world: World;
  let x0 = 0;
  let z0 = 0;
  let h0 = 0;

  beforeAll(() => {
    const mat = new THREE.MeshBasicMaterial();
    world = new World(mat, mat, 1337);
    // 测试场地在 (80,80):世界树立于原点,它的生成萤石会干扰光源计数
    world.warmup(5, 5);
    x0 = 80;
    z0 = 80;
    h0 = world.gen.heightAt(x0, z0);
  });

  it('萤石光照逐格衰减,挖掉后归零(纯光照逻辑,不受世界生成光源干扰)', () => {
    // 用裸 Lights 实例在开阔全透明空间测传播,隔离于地图上的天然光源
    const lights = new Lights(() => false);
    lights.addSource(0, 0, 0, 15);
    lights.recompute();
    expect(lights.lightAt(0, 0, 0)).toBe(15);
    expect(lights.lightAt(1, 0, 0)).toBe(14);
    expect(lights.lightAt(3, 0, 0)).toBe(12);
    expect(lights.lightAt(1, 1, 0)).toBe(13); // 曼哈顿距离 2
    expect(lights.lightAt(15, 0, 0)).toBe(0); // 15 格外无光
    lights.removeSource(0, 0, 0);
    lights.recompute();
    expect(lights.lightAt(0, 0, 0)).toBe(0);
    expect(lights.lightAt(1, 0, 0)).toBe(0);
    expect(lights.sourceCount).toBe(0);
  });

  it('火把光照 14,且被不透明墙遮挡(绕行衰减更多)', () => {
    const ty = h0 + 1;
    world.setBlock(x0, ty, z0, Block.Torch);
    expect(world.lights.lightAt(x0, ty, z0)).toBe(14);
    const openLight = world.lights.lightAt(x0 + 2, ty, z0);
    expect(openLight).toBe(12);
    // 在 x+1 立一面 3×3 石墙
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        world.setBlock(x0 + 1, ty + dy, z0 + dz, Block.Stone);
      }
    }
    const blocked = world.lights.lightAt(x0 + 2, ty, z0);
    expect(blocked).toBeLessThan(openLight); // 只能绕墙,衰减更多
    // 拆墙恢复
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        world.setBlock(x0 + 1, ty + dy, z0 + dz, Block.Air);
      }
    }
    expect(world.lights.lightAt(x0 + 2, ty, z0)).toBe(openLight);
    world.setBlock(x0, ty, z0, Block.Air);
  });

  it('多光源取最大值;光源数量有上限', () => {
    world.setBlock(x0 + 4, h0 + 2, z0, Block.Torch);
    world.setBlock(x0 - 4, h0 + 2, z0, Block.Glowstone);
    // 中点:距火把 4(14-4=10),距萤石 4(15-4=11)→ 取 11
    expect(world.lights.lightAt(x0, h0 + 2, z0)).toBe(11);
    world.setBlock(x0 + 4, h0 + 2, z0, Block.Air);
    world.setBlock(x0 - 4, h0 + 2, z0, Block.Air);

    const lights = new Lights(() => false);
    for (let i = 0; i < 128; i++) {
      expect(lights.addSource(i * 7 - 448, 0, i, 14)).toBe(true);
    }
    expect(lights.addSource(999, 0, 0, 14)).toBe(false); // 超上限
  });

  it('负坐标键编码正确(世界西半球的光源,编码错会静默失灵)', () => {
    const lights = new Lights(() => false);
    lights.addSource(-300, 40, -520, 14);
    const changed = lights.recompute();
    expect(lights.lightAt(-300, 40, -520)).toBe(14);
    expect(lights.lightAt(-299, 40, -520)).toBe(13);
    expect(lights.lightAt(-300, 41, -521)).toBe(12);
    // 变化格子的解码坐标要落在光源邻域内
    for (const [x, y, z] of changed) {
      expect(Math.abs(x + 300)).toBeLessThanOrEqual(14);
      expect(Math.abs(y - 40)).toBeLessThanOrEqual(14);
      expect(Math.abs(z + 520)).toBeLessThanOrEqual(14);
    }
  });

  it('增量传播与全量重算等价(区块流入光源零卡顿路径)', () => {
    const a = new Lights(() => false);
    a.addSource(10, 60, -20, 15);
    a.recompute();
    a.addSource(14, 60, -20, 12);
    const raised = a.spreadInto(14, 60, -20, 12);
    // 对照:同样两个光源全量重算
    const b = new Lights(() => false);
    b.addSource(10, 60, -20, 15);
    b.addSource(14, 60, -20, 12);
    b.recompute();
    for (let x = -8; x <= 32; x++) {
      expect(a.lightAt(x, 60, -20)).toBe(b.lightAt(x, 60, -20));
    }
    // 只有靠近新光源、且旧光照更弱的一侧被抬升
    expect(raised.length).toBeGreaterThan(0);
    for (const [x] of raised) {
      expect(x).toBeGreaterThan(10);
    }
  });
});
