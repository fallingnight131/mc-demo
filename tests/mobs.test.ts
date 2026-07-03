import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { Block } from '../src/blocks';
import { explosionDamage, moveMob, type MobBody } from '../src/mobs';
import { World } from '../src/world';

function makeBody(x: number, y: number, z: number): MobBody {
  return {
    pos: new THREE.Vector3(x, y, z),
    vel: new THREE.Vector3(),
    heading: 0,
    moving: false,
    speed: 1.5,
    onGround: false,
    half: 0.32,
    height: 0.85,
  };
}

const DT = 1 / 60;

describe('mob 物理', () => {
  let world: World;
  // 用出生点做基准:保证周围无树无南瓜、地形平缓
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

  it('从空中落到地表并稳定站立', () => {
    const b = makeBody(x0 + 0.5, h0 + 4, z0 + 0.5);
    for (let i = 0; i < 180; i++) moveMob(b, world, DT);
    expect(b.onGround).toBe(true);
    expect(b.pos.y).toBeCloseTo(h0 + 1, 1);
    expect(Number.isFinite(b.pos.x)).toBe(true);
  });

  it('行走会移动,且脚不会陷进固体方块', () => {
    const b = makeBody(x0 + 0.5, h0 + 1.01, z0 + 0.5);
    b.moving = true;
    b.heading = Math.PI / 2; // 前进方向 (-sin, -cos) → -x
    for (let i = 0; i < 90; i++) {
      moveMob(b, world, DT);
      const feet = world.getBlock(
        Math.floor(b.pos.x),
        Math.floor(b.pos.y + 0.1),
        Math.floor(b.pos.z),
      );
      expect(feet === Block.Air || feet === Block.Water || feet >= Block.Flow4).toBe(true);
    }
    expect(b.pos.x).toBeLessThan(x0 + 0.5 - 1);
  });

  it('遇 1 格台阶自动小跳上去', () => {
    // 在行进方向上砌一格台阶
    world.setBlock(x0 - 2, h0 + 1, z0, Block.Stone);
    const b = makeBody(x0 + 0.5, h0 + 1.01, z0 + 0.5);
    b.moving = true;
    b.heading = Math.PI / 2; // 朝 -x 走
    let maxY = b.pos.y;
    for (let i = 0; i < 240; i++) {
      moveMob(b, world, DT);
      maxY = Math.max(maxY, b.pos.y);
    }
    expect(maxY).toBeGreaterThan(h0 + 1.5); // 确实跳起过
    world.setBlock(x0 - 2, h0 + 1, z0, Block.Air);
  });

  it('水中上浮到水面附近', () => {
    // 就地挖一口 1×1×3 的井并灌水
    const wx = x0 + 3;
    const wz = z0 + 3;
    const wh = world.gen.heightAt(wx, wz);
    for (let y = wh - 2; y <= wh; y++) world.setBlock(wx, y, wz, Block.Water);
    const b = makeBody(wx + 0.5, wh - 2, wz + 0.5);
    for (let i = 0; i < 180; i++) moveMob(b, world, DT);
    expect(b.pos.y).toBeGreaterThan(wh - 1); // 从井底浮起
    for (let y = wh - 2; y <= wh; y++) world.setBlock(wx, y, wz, Block.Stone);
  });

  it('鸡扑翼缓降:下落速度被限制且安全落地', () => {
    const b = makeBody(x0 + 0.5, h0 + 8, z0 + 0.5);
    b.half = 0.2;
    b.height = 0.62;
    b.slowFall = true;
    let minVy = 0;
    for (let i = 0; i < 300; i++) {
      moveMob(b, world, DT);
      minVy = Math.min(minVy, b.vel.y);
    }
    expect(minVy).toBeGreaterThanOrEqual(-2.81); // 从未超过缓降限速
    expect(b.onGround).toBe(true);
    expect(b.pos.y).toBeCloseTo(h0 + 1, 1);
  });

  it('爆炸伤害:半径内致命、1.9 倍半径内擦伤、更远无伤', () => {
    expect(explosionDamage(2, 3.6)).toBe(3);
    expect(explosionDamage(5, 3.6)).toBe(1);
    expect(explosionDamage(8, 3.6)).toBe(0);
  });
});
