// 玩家:重力、跳跃、游泳与逐轴 AABB 体素碰撞
import * as THREE from 'three';
import { isWater } from './blocks';
import {
  EYE_HEIGHT,
  GRAVITY,
  JUMP_SPEED,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  SPRINT_SPEED,
  WALK_SPEED,
  WORLD_WALL_RADIUS,
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
  /** 创造模式:飞行观察世界(空格升 / Shift 降),伤害豁免由上层处理 */
  creative = false;
  private hitWall = false; // 本子步内是否发生水平碰撞(用于出水攀爬)

  constructor(private readonly world: BlockWorld) {}

  eyePos(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.pos.x, this.pos.y + EYE_HEIGHT, this.pos.z);
  }

  isInWater(): boolean {
    return isWater(
      this.world.getBlock(
        Math.floor(this.pos.x),
        Math.floor(this.pos.y + 0.9),
        Math.floor(this.pos.z),
      ),
    );
  }

  /** 脚部是否接触水(比身体中心宽松,用于水面过渡与涉水判定) */
  isTouchingWater(): boolean {
    return isWater(
      this.world.getBlock(
        Math.floor(this.pos.x),
        Math.floor(this.pos.y + 0.1),
        Math.floor(this.pos.z),
      ),
    );
  }

  update(dt: number, input: PlayerInput): void {
    this.stepPhysics(dt, input);
    // 空气墙:世界为有限圆域,超出边界把玩家径向推回(Terraria 3D)
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > WORLD_WALL_RADIUS) {
      const s = WORLD_WALL_RADIUS / r;
      this.pos.x *= s;
      this.pos.z *= s;
      // 消掉向外的速度分量
      const nx = this.pos.x / WORLD_WALL_RADIUS;
      const nz = this.pos.z / WORLD_WALL_RADIUS;
      const vOut = this.vel.x * nx + this.vel.z * nz;
      if (vOut > 0) {
        this.vel.x -= vOut * nx;
        this.vel.z -= vOut * nz;
      }
    }
  }

  private stepPhysics(dt: number, input: PlayerInput): void {
    // 拆分子步,避免低帧率时穿墙
    const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) this.substep(h, input);
  }

  private substep(dt: number, input: PlayerInput): void {
    if (this.creative) {
      // 创造飞行:无重力无水感,平移恒速,空格升 / Shift(冲刺键)降
      const FLY = 11;
      const fs = Math.sin(this.yaw);
      const fc = Math.cos(this.yaw);
      let tx = -fs * input.forward + fc * input.strafe;
      let tz = -fc * input.forward - fs * input.strafe;
      const flen = Math.hypot(tx, tz);
      if (flen > 1e-6) {
        tx = (tx / flen) * FLY;
        tz = (tz / flen) * FLY;
      } else {
        tx = 0;
        tz = 0;
      }
      this.vel.x = approach(this.vel.x, tx, 60 * dt);
      this.vel.z = approach(this.vel.z, tz, 60 * dt);
      const vy = (input.jump ? 9 : 0) + (input.sprint ? -9 : 0);
      this.vel.y = approach(this.vel.y, vy, 60 * dt);
      this.onGround = false;
      this.hitWall = false;
      this.moveAxis(1, this.vel.y * dt);
      this.moveAxis(0, this.vel.x * dt);
      this.moveAxis(2, this.vel.z * dt);
      return;
    }
    const submerged = this.isInWater(); // 身体中心没入水中
    const feetInWater = this.isTouchingWater(); // 至少脚部在水里(含水面过渡区)

    // 水平目标速度(基于朝向):水中略减速
    const speedFactor = submerged ? 0.6 : feetInWater ? 0.85 : 1;
    const speed = (input.sprint ? SPRINT_SPEED : WALK_SPEED) * speedFactor;
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
    const accel = this.onGround || feetInWater ? 25 : 6;
    this.vel.x = approach(this.vel.x, tx, accel * dt);
    this.vel.z = approach(this.vel.z, tz, accel * dt);

    // 垂直速度
    if (submerged) {
      // 水下:低重力、慢沉降,按住跳跃持续上游
      if (input.jump) {
        this.vel.y = approach(this.vel.y, 3.8, 30 * dt);
      } else {
        this.vel.y = Math.max(this.vel.y - 7 * dt, -3.2);
      }
    } else if (feetInWater && !this.onGround) {
      // 水面过渡区(中心已出水、脚还在水里):重力减半,
      // 按住跳跃仍能向上顶,避免在水面反复浮沉
      if (input.jump) {
        this.vel.y = approach(this.vel.y, 3.2, 26 * dt);
      } else {
        this.vel.y = Math.max(this.vel.y - 14 * dt, -50);
      }
    } else {
      if (input.jump && this.onGround) this.vel.y = JUMP_SPEED;
      this.vel.y = Math.max(this.vel.y - GRAVITY * dt, -50);
    }

    this.onGround = false;
    this.hitWall = false;
    this.moveAxis(1, this.vel.y * dt);
    this.moveAxis(0, this.vel.x * dt);
    this.moveAxis(2, this.vel.z * dt);

    // MC 式出水攀爬:在水中贴着方块边缘推进时获得向上推力,
    // 持续顶墙会一格格"翻"上岸,玩家不会被困在水里
    if (
      (submerged || feetInWater) &&
      this.hitWall &&
      (input.forward !== 0 || input.strafe !== 0)
    ) {
      this.vel.y = Math.max(this.vel.y, 5.6);
    }
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
    if (axis !== 1) this.hitWall = true;

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
