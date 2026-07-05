import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { Block } from '../src/blocks';
import { thirdPersonDist } from '../src/playermodel';
import { World } from '../src/world';

describe('第三人称相机回缩', () => {
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

  it('身后开阔时拉满距离', () => {
    // 朝天空方向(往上后方)必然无遮挡
    const eye = new THREE.Vector3(x0 + 0.5, h0 + 2.6, z0 + 0.5);
    const back = new THREE.Vector3(0, 0.5, 1).normalize();
    expect(thirdPersonDist(world, eye, back, 4)).toBe(4);
  });

  it('身后贴墙时收到墙前,不穿墙', () => {
    // 在身后 2 格砌一堵 3 高的墙
    for (let dy = 0; dy < 3; dy++) {
      world.setBlock(x0, h0 + 1 + dy, z0 + 2, Block.Stone);
    }
    const eye = new THREE.Vector3(x0 + 0.5, h0 + 2.6, z0 + 0.5);
    const back = new THREE.Vector3(0, 0, 1); // 正后方
    const d = thirdPersonDist(world, eye, back, 4);
    expect(d).toBeLessThan(2);
    expect(d).toBeGreaterThanOrEqual(0.6);
    for (let dy = 0; dy < 3; dy++) {
      world.setBlock(x0, h0 + 1 + dy, z0 + 2, Block.Air);
    }
  });
});
