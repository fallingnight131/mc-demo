// 实体层 · 弹幕(见 ARCHITECTURE.md §3.5 / §4.2)
// 武器剑气(泰拉之刃)、未来的远程/魔法武器与 boss 弹幕共用:
// 位置 + 速度 + 重力,逐帧用"上一位置 → 新位置"线段做两类命中 ——
// 方块(world.raycast 体素步进)与生物(targets.raycast AABB)。
// 伤害/击退经 targets.hurt 走统一战斗结算。
import * as THREE from 'three';
import type { Entity, EntityManager } from './entities';

export interface ProjectileSpec {
  damage: number;
  knockback: number;
  knockUp: number;
  /** 下坠加速度(格/s²,0 = 直线飞行) */
  gravity: number;
  /** 存活时长(秒) */
  life: number;
  /** 穿透:命中生物后不消失 */
  pierce?: boolean;
  /** 自定义外观;缺省为发光小方块 */
  mesh?: THREE.Object3D;
  /** 命中生物回调(吸血/特效等) */
  onHitMob?: (x: number, y: number, z: number) => void;
  /** 命中方块回调(爆炸弹等) */
  onHitBlock?: (x: number, y: number, z: number) => void;
}

/** 方块命中查询(World 满足) */
export interface BlockRaycaster {
  raycast(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number,
  ): { x: number; y: number; z: number } | null;
}

/** 生物命中查询与伤害结算(Mobs 满足;boss 部件未来同样实现该接口) */
export interface TargetHit {
  dist: number;
}
export interface Targets {
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): TargetHit | null;
  hurt(hit: TargetHit, dir: THREE.Vector3, dmg: number, knock: number, knockUp: number): number;
}

export class Projectiles {
  readonly group = new THREE.Group();
  private alive = 0;

  constructor(
    private readonly blocks: BlockRaycaster,
    private readonly targets: Targets,
    private readonly entities: EntityManager,
  ) {}

  get count(): number {
    return this.alive;
  }

  spawn(pos: THREE.Vector3, vel: THREE.Vector3, spec: ProjectileSpec): void {
    this.alive++;
    this.entities.add(new Projectile(this, this.blocks, this.targets, pos, vel, spec));
  }

  /** 内部:实体消亡时计数回收 */
  released(): void {
    this.alive--;
  }
}

const defaultMesh = (): THREE.Object3D =>
  new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.18, 0.18),
    new THREE.MeshBasicMaterial({ color: 0x9fe8ff }),
  );

class Projectile implements Entity {
  private readonly pos: THREE.Vector3;
  private readonly vel: THREE.Vector3;
  private readonly mesh: THREE.Object3D;
  private life: number;
  private readonly step = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();

  constructor(
    private readonly sys: Projectiles,
    private readonly blocks: BlockRaycaster,
    private readonly targets: Targets,
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    private readonly spec: ProjectileSpec,
  ) {
    this.pos = pos.clone();
    this.vel = vel.clone();
    this.life = spec.life;
    this.mesh = spec.mesh ?? defaultMesh();
    this.mesh.position.copy(this.pos);
    this.sys.group.add(this.mesh);
  }

  update(dt: number): boolean {
    this.life -= dt;
    if (this.life <= 0) return false;
    this.vel.y -= this.spec.gravity * dt;
    this.step.copy(this.vel).multiplyScalar(dt);
    const dist = this.step.length();
    if (dist > 1e-8) {
      this.dir.copy(this.step).normalize();
      const s = this.spec;
      // 生物优先(与近战一致:命中即结算伤害与击退)
      const mhit = this.targets.raycast(this.pos, this.dir, dist);
      if (mhit) {
        const ax = this.pos.x + this.dir.x * mhit.dist;
        const ay = this.pos.y + this.dir.y * mhit.dist;
        const az = this.pos.z + this.dir.z * mhit.dist;
        this.targets.hurt(mhit, this.dir, s.damage, s.knockback, s.knockUp);
        s.onHitMob?.(ax, ay, az);
        if (!s.pierce) return false;
      }
      const bhit = this.blocks.raycast(this.pos, this.dir, dist);
      if (bhit) {
        s.onHitBlock?.(bhit.x, bhit.y, bhit.z);
        return false;
      }
    }
    this.pos.add(this.step);
    this.mesh.position.copy(this.pos);
    return true;
  }

  dispose(): void {
    this.sys.group.remove(this.mesh);
    this.sys.released();
  }
}
