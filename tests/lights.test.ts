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
    world.warmup(0, 0);
    const s = world.gen.findSpawn();
    x0 = Math.floor(s.x);
    z0 = Math.floor(s.z);
    h0 = world.gen.heightAt(x0, z0);
  });

  it('萤石光照逐格衰减,挖掉后归零', () => {
    world.setBlock(x0, h0 + 2, z0, Block.Glowstone);
    expect(world.lights.lightAt(x0, h0 + 2, z0)).toBe(15);
    expect(world.lights.lightAt(x0 + 1, h0 + 2, z0)).toBe(14);
    expect(world.lights.lightAt(x0 + 3, h0 + 2, z0)).toBe(12);
    // 曼哈顿距离 2 的对角
    expect(world.lights.lightAt(x0 + 1, h0 + 3, z0)).toBe(13);
    // 15 格外无光
    expect(world.lights.lightAt(x0 + 15, h0 + 2, z0)).toBe(0);
    world.setBlock(x0, h0 + 2, z0, Block.Air);
    expect(world.lights.lightAt(x0, h0 + 2, z0)).toBe(0);
    expect(world.lights.lightAt(x0 + 1, h0 + 2, z0)).toBe(0);
    expect(world.lights.sourceCount).toBe(0);
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
      expect(lights.addSource(i * 40, 0, 0, 14)).toBe(true);
    }
    expect(lights.addSource(9999, 0, 0, 14)).toBe(false); // 超上限
  });
});
