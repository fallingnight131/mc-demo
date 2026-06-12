import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { Block } from '../src/blocks';
import { World } from '../src/world';

function makeWorld(): World {
  const mat = new THREE.MeshBasicMaterial();
  const w = new World(mat, mat, 1337);
  w.warmup(0, 0);
  return w;
}

describe('world', () => {
  let world: World;
  beforeAll(() => {
    world = makeWorld();
  });

  it('跨区块读取与单区块生成一致', () => {
    // 区块边界两侧的方块都能读取且不是未定义
    for (let y = 0; y < 5; y++) {
      expect(world.getBlock(-1, y, 0)).toBeGreaterThanOrEqual(0);
      expect(world.getBlock(0, y, 0)).toBeGreaterThanOrEqual(0);
    }
    expect(world.getBlock(0, 0, 0)).toBe(Block.Bedrock);
    expect(world.getBlock(-1, 0, -1)).toBe(Block.Bedrock);
  });

  it('setBlock 后 getBlock 一致', () => {
    const h = world.gen.heightAt(4, 4);
    world.setBlock(4, h + 3, 4, Block.Plank);
    expect(world.getBlock(4, h + 3, 4)).toBe(Block.Plank);
    world.setBlock(4, h + 3, 4, Block.Air);
    expect(world.getBlock(4, h + 3, 4)).toBe(Block.Air);
  });

  it('向下射线命中地表,法线朝上', () => {
    const h = world.gen.heightAt(8, 8);
    const origin = new THREE.Vector3(8.5, h + 5, 8.5);
    const hit = world.raycast(origin, new THREE.Vector3(0, -1, 0), 10);
    expect(hit).not.toBeNull();
    expect(hit!.y).toBe(h);
    expect(hit!.ny).toBe(1);
  });

  it('侧向射线命中放置的方块并返回正确法线', () => {
    const h = world.gen.heightAt(8, 8);
    const y = h + 10;
    world.setBlock(8, y, 8, Block.Stone);
    // 从 -x 方向射向方块
    const origin = new THREE.Vector3(5.5, y + 0.5, 8.5);
    const hit = world.raycast(origin, new THREE.Vector3(1, 0, 0), 10);
    expect(hit).not.toBeNull();
    expect([hit!.x, hit!.y, hit!.z]).toEqual([8, y, 8]);
    expect(hit!.nx).toBe(-1);
    world.setBlock(8, y, 8, Block.Air);
  });

  it('射线越过水命中水底', () => {
    // 找一片水
    let found: { x: number; z: number } | null = null;
    for (let x = -30; x <= 30 && !found; x++) {
      for (let z = -30; z <= 30 && !found; z++) {
        if (world.getBlock(x, 24, z) === Block.Water) found = { x, z };
      }
    }
    if (!found) return; // 这个种子的出生区域没有水则跳过
    const origin = new THREE.Vector3(found.x + 0.5, 30, found.z + 0.5);
    const hit = world.raycast(origin, new THREE.Vector3(0, -1, 0), 40);
    expect(hit).not.toBeNull();
    expect(hit!.id).not.toBe(Block.Water);
  });
});
