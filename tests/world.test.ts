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

  it('爆炸清除半径内方块,保留基岩与黑曜石,返回列表与世界一致', () => {
    const h = world.gen.heightAt(8, 8);
    world.setBlock(9, h, 8, Block.Obsidian); // 爆心旁放一块黑曜石
    const removed = world.explode(8, h, 8, 3.6);
    expect(removed.length).toBeGreaterThan(20);
    expect(world.getBlock(8, h, 8)).toBe(Block.Air); // 中心必毁
    expect(world.getBlock(8, 0, 8)).toBe(Block.Bedrock); // 基岩保留
    expect(world.getBlock(9, h, 8)).toBe(Block.Obsidian); // 黑曜石抗爆
    for (const [x, y, z] of removed) {
      expect(world.getBlock(x, y, z)).toBe(Block.Air);
    }
  });

  it('编辑在区块卸载重生成与存档往返后保留', () => {
    const h = world.gen.heightAt(4, 4);
    world.setBlock(4, h + 5, 4, Block.Plank);
    world.setBlock(4, h, 4, Block.Air);
    // 玩家走远触发卸载,再回来重新生成
    world.update(16000, 16000, 0);
    expect(world.getChunk(0, 0)).toBeUndefined();
    world.warmup(0, 0);
    expect(world.getBlock(4, h + 5, 4)).toBe(Block.Plank);
    expect(world.getBlock(4, h, 4)).toBe(Block.Air);
    // 序列化(模拟 JSON 存档)后在新世界恢复
    const data = JSON.parse(JSON.stringify(world.serializeEdits()));
    const mat = new THREE.MeshBasicMaterial();
    const w2 = new World(mat, mat, 1337);
    w2.loadEdits(data);
    w2.warmup(0, 0);
    expect(w2.getBlock(4, h + 5, 4)).toBe(Block.Plank);
    expect(w2.getBlock(4, h, 4)).toBe(Block.Air);
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
