// 玩家:重力、跳跃、游泳与逐轴 AABB 体素碰撞
import * as THREE from 'three';
import { Block } from './blocks';
import {
  EYE_HEIGHT,
  GRAVITY,
  JUMP_SPEED,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  SPRINT_SPEED,
  WALK_SPEED,
} from './config';

export interface PlayerInput {
  forward: number; // -1 | 0 | 1
  strafe: number;
  jump: boolean;
  sprint: boolean;
}

/** 玩家物理只依赖这个最小接口,便于无渲染环境下测试 */
export interface BlockWorld {
  isSolid(x: number, y: number, z: number): boolean;
  getBlock(x: number, y: number, z: number): number;
}

const EPS = 1e-3;
const HALF = PLAYER_WIDTH / 2;

function approach(cur: number, target: number, maxDelta: number): number {
  const d = target - cur;
  if (d > maxDelta) return cur + maxDelta;
  if (d < -maxDelta) return cur - maxDelta;
  return target;
}

export class Player {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  onGround = false;

  constructor(private readonly world: BlockWorld) {}

  eyePos(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.pos.x, this.pos.y + EYE_HEIGHT, this.pos.z);
  }

  isInWater(): boolean {
    return (
      this.world.getBlock(
        Math.floor(this.pos.x),
        Math.floor(this.pos.y + 0.9),
        Math.floor(this.pos.z),
      ) === Block.Water
    );
  }

  update(dt: number, input: PlayerInput): void {
    // 拆分子步,避免低帧率时穿墙
    const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) this.substep(h, input);
  }

  private substep(dt: number, input: PlayerInput): void {
    const inWater = this.isInWater();

    // 水平目标速度(基于朝向)
    const speed = (input.sprint ? SPRINT_SPEED : WALK_SPEED) * (inWater ? 0.55 : 1);
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    let tx = -s * input.forward + c * input.strafe;
    let tz = -c * input.forward - s * input.strafe;
    const len = Math.hypot(tx, tz);
    if (len > 1e-6) {
      tx = (tx / len) * speed;
      tz = (tz / len) * speed;
    } else {
      tx = 0;
      tz = 0;
    }
    const accel = this.onGround || inWater ? 25 : 6;
    this.vel.x = approach(this.vel.x, tx, accel * dt);
    this.vel.z = approach(this.vel.z, tz, accel * dt);

    // 垂直速度
    if (inWater) {
      if (input.jump) {
        this.vel.y = approach(this.vel.y, 3.2, 24 * dt);
      } else {
        this.vel.y = Math.max(this.vel.y - 12 * dt, -4);
      }
    } else {
      if (input.jump && this.onGround) this.vel.y = JUMP_SPEED;
      this.vel.y = Math.max(this.vel.y - GRAVITY * dt, -50);
    }

    this.onGround = false;
    this.moveAxis(1, this.vel.y * dt);
    this.moveAxis(0, this.vel.x * dt);
    this.moveAxis(2, this.vel.z * dt);
  }

  private moveAxis(axis: 0 | 1 | 2, delta: number): void {
    if (delta === 0) return;
    const p = this.pos;
    if (axis === 0) p.x += delta;
    else if (axis === 1) p.y += delta;
    else p.z += delta;

    const minX = Math.floor(p.x - HALF);
    const maxX = Math.floor(p.x + HALF - 1e-9);
    const minY = Math.floor(p.y);
    const maxY = Math.floor(p.y + PLAYER_HEIGHT - 1e-9);
    const minZ = Math.floor(p.z - HALF);
    const maxZ = Math.floor(p.z + HALF - 1e-9);

    let hit = false;
    let bound = delta > 0 ? Infinity : -Infinity;
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          if (!this.world.isSolid(x, y, z)) continue;
          hit = true;
          const v = axis === 0 ? x : axis === 1 ? y : z;
          bound = delta > 0 ? Math.min(bound, v) : Math.max(bound, v + 1);
        }
      }
    }
    if (!hit) return;

    let clamped: number;
    if (axis === 0) {
      clamped = delta > 0 ? bound - HALF - EPS : bound + HALF + EPS;
    } else if (axis === 1) {
      clamped = delta > 0 ? bound - PLAYER_HEIGHT - EPS : bound + EPS;
    } else {
      clamped = delta > 0 ? bound - HALF - EPS : bound + HALF + EPS;
    }

    const cur = axis === 0 ? p.x : axis === 1 ? p.y : p.z;
    // 解算距离远超本次位移说明整个人嵌在固体里(如区块未加载),
    // 此时回退本次移动而不是把人弹出去
    if (Math.abs(clamped - cur) > Math.abs(delta) + 0.5) {
      if (axis === 0) p.x = cur - delta;
      else if (axis === 1) p.y = cur - delta;
      else p.z = cur - delta;
    } else if (axis === 0) {
      p.x = clamped;
    } else if (axis === 1) {
      p.y = clamped;
      if (delta < 0) this.onGround = true;
    } else {
      p.z = clamped;
    }
    if (axis === 0) this.vel.x = 0;
    else if (axis === 1) this.vel.y = 0;
    else this.vel.z = 0;
  }

  /** 给定方块是否与玩家包围盒相交(放置方块前校验) */
  intersectsBlock(bx: number, by: number, bz: number): boolean {
    return (
      bx + 1 > this.pos.x - HALF &&
      bx < this.pos.x + HALF &&
      by + 1 > this.pos.y &&
      by < this.pos.y + PLAYER_HEIGHT &&
      bz + 1 > this.pos.z - HALF &&
      bz < this.pos.z + HALF
    );
  }
}
