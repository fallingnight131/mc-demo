import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { Block } from '../src/blocks';
import { FallingBlocks } from '../src/falling';
import { World } from '../src/world';

const DT = 1 / 60;

describe('方块物理', () => {
  let world: World;
  let falling: FallingBlocks;
  let x0 = 0;
  let z0 = 0;
  let h0 = 0;

  beforeAll(() => {
    const mat = new THREE.MeshBasicMaterial();
    world = new World(mat, mat, 1337);
    world.warmup(0, 0);
    falling = new FallingBlocks(new THREE.Texture(), world);
    world.onBlockChanged = (x, y, z) => {
      falling.wake(x, y + 1, z);
      falling.wake(x, y, z);
    };
    const s = world.gen.findSpawn();
    x0 = Math.floor(s.x);
    z0 = Math.floor(s.z);
    h0 = world.gen.heightAt(x0, z0);
  });

  it('悬空沙子坠落并在地面落定', () => {
    world.setBlock(x0, h0 + 4, z0, Block.Sand); // 放下即悬空 → 转为下落实体
    expect(world.getBlock(x0, h0 + 4, z0)).toBe(Block.Air);
    expect(falling.count).toBe(1);
    for (let i = 0; i < 120 && falling.count > 0; i++) falling.update(DT);
    expect(falling.count).toBe(0);
    expect(world.getBlock(x0, h0 + 1, z0)).toBe(Block.Sand);
    world.setBlock(x0, h0 + 1, z0, Block.Air);
  });

  it('挖掉支撑后沙柱链式坠落,落回原有堆叠', () => {
    const x = x0 + 2;
    world.setBlock(x, h0 + 1, z0, Block.Stone);
    world.setBlock(x, h0 + 2, z0, Block.Sand);
    world.setBlock(x, h0 + 3, z0, Block.Sand);
    expect(falling.count).toBe(0); // 有支撑,不动
    world.setBlock(x, h0 + 1, z0, Block.Air); // 抽掉支撑
    expect(falling.count).toBe(2); // 两块沙链式起飞
    for (let i = 0; i < 180 && falling.count > 0; i++) falling.update(DT);
    expect(world.getBlock(x, h0 + 1, z0)).toBe(Block.Sand);
    expect(world.getBlock(x, h0 + 2, z0)).toBe(Block.Sand);
    expect(world.getBlock(x, h0 + 3, z0)).toBe(Block.Air);
    world.setBlock(x, h0 + 1, z0, Block.Air);
    world.setBlock(x, h0 + 2, z0, Block.Air);
  });

  it('火把被流进来的水冲走,并触发掉落回调', () => {
    const x = x0 - 3;
    const washed: number[] = [];
    world.water.onWashed = (wx, wy, wz, id) => washed.push(id);
    world.setBlock(x, h0 + 1, z0, Block.Torch);
    expect(world.getBlock(x, h0 + 1, z0)).toBe(Block.Torch);
    world.setBlock(x + 1, h0 + 1, z0, Block.Water); // 旁边放水源
    for (let i = 0; i < 6; i++) world.water.tick();
    expect(washed).toContain(Block.Torch);
    const now = world.getBlock(x, h0 + 1, z0);
    expect(now === Block.Torch).toBe(false); // 火把没了(变流水)
    expect(world.lights.lightAt(x, h0 + 1, z0) === 14).toBe(false); // 光源同步移除
    world.setBlock(x + 1, h0 + 1, z0, Block.Air);
    for (let i = 0; i < 8; i++) world.water.tick(); // 水退去
  });
});
