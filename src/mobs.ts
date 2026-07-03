// 简单生物:猪/羊/鸡 —— 盒子模型、随机漫步、遇台阶小跳、会浮水、可击退击杀
import * as THREE from 'three';
import { Block, isWater } from './blocks';
import { buildMobTextures, type MobSkin } from './textures';

const MAX_MOBS = 8;
const SPAWN_NEAR = 18; // 生成距离范围(玩家周围环带)
const SPAWN_FAR = 42;
const DESPAWN_DIST = 90;
const GRAVITY = 24;
const HOP_SPEED = 7.2; // 遇 1 格台阶的小跳

export type MobKind = 'pig' | 'sheep' | 'chicken';

interface SpeciesDef {
  hp: number;
  walk: number;
  flee: number;
  half: number; // 碰撞半宽
  height: number; // 碰撞高
  slowFall: boolean; // 鸡扑翼缓降
}

const SPECIES: Record<MobKind, SpeciesDef> = {
  pig: { hp: 3, walk: 1.5, flee: 4.6, half: 0.32, height: 0.85, slowFall: false },
  sheep: { hp: 3, walk: 1.3, flee: 4.2, half: 0.35, height: 1.0, slowFall: false },
  chicken: { hp: 2, walk: 1.1, flee: 3.6, half: 0.2, height: 0.62, slowFall: true },
};

export interface MobWorldQuery {
  isSolid(x: number, y: number, z: number): boolean;
  getBlock(x: number, y: number, z: number): number;
}

/** 物理状态(与渲染分离,便于单元测试) */
export interface MobBody {
  pos: THREE.Vector3; // 脚底中心
  vel: THREE.Vector3;
  heading: number; // 朝向(弧度),前进方向为 (-sin, -cos)
  moving: boolean;
  speed: number;
  onGround: boolean;
  half: number;
  height: number;
  slowFall?: boolean;
}

function collides(
  world: MobWorldQuery,
  x: number,
  y: number,
  z: number,
  half: number,
  height: number,
): boolean {
  for (const dx of [-half, half]) {
    for (const dz of [-half, half]) {
      for (const dy of [0.02, height * 0.5, height - 0.02]) {
        if (world.isSolid(Math.floor(x + dx), Math.floor(y + dy), Math.floor(z + dz))) {
          return true;
        }
      }
    }
  }
  return false;
}

/** 推进一步物理:行走意图 + 重力/浮力 + 分轴碰撞 + 遇台阶小跳 */
export function moveMob(b: MobBody, world: MobWorldQuery, dt: number): void {
  const inWater = isWater(
    world.getBlock(Math.floor(b.pos.x), Math.floor(b.pos.y + 0.3), Math.floor(b.pos.z)),
  );

  // 水平速度趋向意图速度(击退的额外速度随之衰减)
  const f = Math.exp(-8 * dt);
  const wx = b.moving ? -Math.sin(b.heading) * b.speed : 0;
  const wz = b.moving ? -Math.cos(b.heading) * b.speed : 0;
  b.vel.x = wx + (b.vel.x - wx) * f;
  b.vel.z = wz + (b.vel.z - wz) * f;

  // 垂直:水里上浮(到水面自然来回轻浮),岸上重力;鸡下落时扑翼缓降
  if (inWater) {
    b.vel.y = Math.min(b.vel.y + 26 * dt, 2.2);
  } else {
    b.vel.y -= GRAVITY * dt;
    if (b.slowFall && b.vel.y < -2.8) b.vel.y = -2.8;
  }

  const hScale = inWater ? 0.65 : 1;

  // X 轴
  const nx = b.pos.x + b.vel.x * hScale * dt;
  if (nx !== b.pos.x && collides(world, nx, b.pos.y, b.pos.z, b.half, b.height)) {
    if (b.onGround && !inWater) b.vel.y = HOP_SPEED;
  } else {
    b.pos.x = nx;
  }
  // Z 轴
  const nz = b.pos.z + b.vel.z * hScale * dt;
  if (nz !== b.pos.z && collides(world, b.pos.x, b.pos.y, nz, b.half, b.height)) {
    if (b.onGround && !inWater) b.vel.y = HOP_SPEED;
  } else {
    b.pos.z = nz;
  }
  // Y 轴
  const ny = b.pos.y + b.vel.y * dt;
  if (b.vel.y <= 0) {
    if (collides(world, b.pos.x, ny, b.pos.z, b.half, b.height)) {
      b.pos.y = Math.floor(ny + 0.02) + 1; // 落到方块顶面
      b.vel.y = 0;
    } else {
      b.pos.y = ny;
    }
    // 支撑检测:脚下 5cm 内有实体即算站稳,避免重力微沉导致状态逐帧闪烁
    b.onGround = collides(world, b.pos.x, b.pos.y - 0.05, b.pos.z, b.half, b.height);
    if (b.onGround && b.vel.y < 0) b.vel.y = 0;
  } else {
    if (collides(world, b.pos.x, ny, b.pos.z, b.half, b.height)) {
      b.vel.y = 0; // 顶头
    } else {
      b.pos.y = ny;
    }
    b.onGround = false;
  }
}

/** 爆炸对生物的伤害:半径内致命,1.9 倍半径内擦伤 */
export function explosionDamage(dist: number, radius: number): number {
  if (dist <= radius) return 3;
  if (dist <= radius * 1.9) return 1;
  return 0;
}

interface Mob {
  kind: MobKind;
  body: MobBody;
  hp: number;
  mode: 'idle' | 'walk' | 'flee';
  timer: number;
  voiceTimer: number;
  flash: number; // 受击红闪剩余时间
  phase: number; // 腿摆动相位
  displayHeading: number; // 平滑转身
  group: THREE.Group;
  legs: THREE.Mesh[];
  legSign: number[]; // 每条腿的摆动相位符号
  mats: THREE.MeshBasicMaterial[]; // 本体专属材质(红闪/昼夜亮度)
}

export interface MobHit {
  mob: Mob;
  dist: number;
}

export class Mobs {
  readonly group = new THREE.Group();
  /** 被击杀时回调(种类与位置),由入口挂粒子与音效 */
  onDeath: ((kind: MobKind, x: number, y: number, z: number) => void) | null = null;
  /** 闲逛叫声回调(种类与玩家距离) */
  onVoice: ((kind: MobKind, dist: number) => void) | null = null;
  /** 自然生成开关(测试中可关闭以保证确定性) */
  autoSpawn = true;

  private readonly list: Mob[] = [];
  private readonly skins: Record<MobKind, MobSkin>;
  private readonly geoCache = new Map<string, THREE.BoxGeometry>();
  private spawnTimer = 0;
  private brightness = 1;

  constructor(
    private readonly world: MobWorldQuery,
    private readonly surfaceAt: (x: number, z: number) => number,
  ) {
    this.skins = buildMobTextures();
  }

  get count(): number {
    return this.list.length;
  }

  /** 测试/调试用状态快照 */
  debugList(): Array<{ kind: MobKind; x: number; y: number; z: number; hp: number }> {
    return this.list.map((m) => ({
      kind: m.kind,
      x: m.body.pos.x,
      y: m.body.pos.y,
      z: m.body.pos.z,
      hp: m.hp,
    }));
  }

  private box(w: number, h: number, d: number, legTop = false): THREE.BoxGeometry {
    const key = `${w},${h},${d},${legTop}`;
    let geo = this.geoCache.get(key);
    if (!geo) {
      geo = new THREE.BoxGeometry(w, h, d);
      if (legTop) geo.translate(0, -h / 2, 0); // 腿绕根部摆动
      this.geoCache.set(key, geo);
    }
    return geo;
  }

  /** 搭一只生物的盒子模型,面部贴图始终在头的 -z 面(前进方向) */
  private buildModel(kind: MobKind): {
    group: THREE.Group;
    legs: THREE.Mesh[];
    legSign: number[];
    mats: THREE.MeshBasicMaterial[];
  } {
    const skin = this.skins[kind];
    const bodyMat = new THREE.MeshBasicMaterial({ map: skin.body });
    const headMat = new THREE.MeshBasicMaterial({ map: skin.head });
    const faceMat = new THREE.MeshBasicMaterial({ map: skin.face });
    const g = new THREE.Group();
    const legs: THREE.Mesh[] = [];
    let legSign: number[] = [];
    const headMats = [headMat, headMat, headMat, headMat, headMat, faceMat];

    if (kind === 'pig') {
      const body = new THREE.Mesh(this.box(0.58, 0.5, 0.95), bodyMat);
      body.position.y = 0.55;
      g.add(body);
      const head = new THREE.Mesh(this.box(0.46, 0.46, 0.34), headMats);
      head.position.set(0, 0.66, -0.6);
      g.add(head);
      for (const [lx, lz] of [
        [-0.17, -0.3],
        [0.17, -0.3],
        [-0.17, 0.3],
        [0.17, 0.3],
      ]) {
        const leg = new THREE.Mesh(this.box(0.15, 0.3, 0.15, true), bodyMat);
        leg.position.set(lx, 0.3, lz);
        legs.push(leg);
        g.add(leg);
      }
      legSign = [1, -1, -1, 1];
    } else if (kind === 'sheep') {
      const body = new THREE.Mesh(this.box(0.7, 0.6, 1.05), bodyMat);
      body.position.y = 0.72;
      g.add(body);
      const head = new THREE.Mesh(this.box(0.4, 0.4, 0.32), headMats);
      head.position.set(0, 0.95, -0.62);
      g.add(head);
      for (const [lx, lz] of [
        [-0.2, -0.32],
        [0.2, -0.32],
        [-0.2, 0.32],
        [0.2, 0.32],
      ]) {
        const leg = new THREE.Mesh(this.box(0.14, 0.42, 0.14, true), headMat);
        leg.position.set(lx, 0.42, lz);
        legs.push(leg);
        g.add(leg);
      }
      legSign = [1, -1, -1, 1];
    } else {
      // chicken
      const body = new THREE.Mesh(this.box(0.42, 0.38, 0.55), bodyMat);
      body.position.y = 0.42;
      g.add(body);
      const head = new THREE.Mesh(this.box(0.24, 0.32, 0.22), headMats);
      head.position.set(0, 0.74, -0.28);
      g.add(head);
      // 两侧小翅膀
      for (const side of [-1, 1]) {
        const wing = new THREE.Mesh(this.box(0.08, 0.26, 0.4), bodyMat);
        wing.position.set(side * 0.25, 0.46, 0.02);
        g.add(wing);
      }
      for (const lx of [-0.1, 0.1]) {
        const leg = new THREE.Mesh(this.box(0.07, 0.24, 0.07, true), headMat);
        leg.position.set(lx, 0.24, 0.05);
        legs.push(leg);
        g.add(leg);
      }
      legSign = [1, -1];
    }
    return { group: g, legs, legSign, mats: [bodyMat, headMat, faceMat] };
  }

  spawnAt(x: number, y: number, z: number, kind: MobKind = 'pig'): void {
    const def = SPECIES[kind];
    const { group, legs, legSign, mats } = this.buildModel(kind);
    group.position.set(x, y, z);
    this.group.add(group);

    const heading = Math.random() * Math.PI * 2;
    this.list.push({
      kind,
      body: {
        pos: new THREE.Vector3(x, y, z),
        vel: new THREE.Vector3(),
        heading,
        moving: false,
        speed: def.walk,
        onGround: false,
        half: def.half,
        height: def.height,
        slowFall: def.slowFall,
      },
      hp: def.hp,
      mode: 'idle',
      timer: 0.5 + Math.random() * 2,
      voiceTimer: 2 + Math.random() * 8,
      flash: 0,
      phase: 0,
      displayHeading: heading,
      group,
      legs,
      legSign,
      mats,
    });
  }

  private trySpawn(playerPos: THREE.Vector3): void {
    const a = Math.random() * Math.PI * 2;
    const d = SPAWN_NEAR + Math.random() * (SPAWN_FAR - SPAWN_NEAR);
    const x = Math.floor(playerPos.x + Math.cos(a) * d);
    const z = Math.floor(playerPos.z + Math.sin(a) * d);
    const h = this.surfaceAt(x, z);
    // 只在已加载的草地上生成(未加载区块 getBlock 返回空气,自然被拒)
    if (this.world.getBlock(x, h, z) !== Block.Grass) return;
    if (this.world.getBlock(x, h + 1, z) !== Block.Air) return;
    const r = Math.random();
    const kind: MobKind = r < 0.4 ? 'pig' : r < 0.75 ? 'sheep' : 'chicken';
    this.spawnAt(x + 0.5, h + 1.01, z + 0.5, kind);
  }

  update(dt: number, playerPos: THREE.Vector3): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 1.6;
      if (this.autoSpawn && this.list.length < MAX_MOBS) this.trySpawn(playerPos);
    }

    for (let i = this.list.length - 1; i >= 0; i--) {
      const m = this.list[i];
      const b = m.body;
      const dist = Math.hypot(
        b.pos.x - playerPos.x,
        b.pos.y - playerPos.y,
        b.pos.z - playerPos.z,
      );
      if (dist > DESPAWN_DIST || b.pos.y < -10) {
        this.removeAt(i);
        continue;
      }

      // 行为:发呆 ↔ 漫步,受击后短暂逃窜
      m.timer -= dt;
      if (m.timer <= 0) {
        if (m.mode === 'idle') {
          m.mode = 'walk';
          m.timer = 1.5 + Math.random() * 2.5;
          b.heading = Math.random() * Math.PI * 2;
          b.speed = SPECIES[m.kind].walk;
          b.moving = true;
        } else {
          m.mode = 'idle';
          m.timer = 1 + Math.random() * 3;
          b.moving = false;
        }
      }

      moveMob(b, this.world, dt);

      // 视觉:腿摆动、平滑转身、受击红闪 × 昼夜亮度
      m.flash = Math.max(0, m.flash - dt);
      const hspeed = Math.hypot(b.vel.x, b.vel.z);
      m.phase += hspeed * dt * 3.4;
      const swing = Math.sin(m.phase) * Math.min(1, hspeed / 2) * 0.75;
      for (let l = 0; l < m.legs.length; l++) {
        m.legs[l].rotation.x = swing * m.legSign[l];
      }
      let dh = b.heading - m.displayHeading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      m.displayHeading += dh * Math.min(1, dt * 8);
      m.group.rotation.y = m.displayHeading;
      m.group.position.copy(b.pos);
      const red = m.flash > 0 ? 1 : this.brightness;
      const gb = m.flash > 0 ? 0.3 : this.brightness;
      for (const mat of m.mats) mat.color.setRGB(red, gb, gb);

      // 闲逛叫声
      m.voiceTimer -= dt;
      if (m.voiceTimer <= 0) {
        m.voiceTimer = 5 + Math.random() * 9;
        if (dist < 26) this.onVoice?.(m.kind, dist);
      }
    }
  }

  /** 射线选中生物(命中盒略大于碰撞盒,好瞄) */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): MobHit | null {
    let best: MobHit | null = null;
    for (const m of this.list) {
      const p = m.body.pos;
      const pad = 0.18;
      const min = [p.x - m.body.half - pad, p.y, p.z - m.body.half - pad];
      const max = [p.x + m.body.half + pad, p.y + m.body.height + 0.2, p.z + m.body.half + pad];
      const o = [origin.x, origin.y, origin.z];
      const d = [dir.x, dir.y, dir.z];
      let t0 = 0;
      let t1 = maxDist;
      let ok = true;
      for (let a = 0; a < 3; a++) {
        if (Math.abs(d[a]) < 1e-8) {
          if (o[a] < min[a] || o[a] > max[a]) {
            ok = false;
            break;
          }
          continue;
        }
        let ta = (min[a] - o[a]) / d[a];
        let tb = (max[a] - o[a]) / d[a];
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 > t1) {
          ok = false;
          break;
        }
      }
      if (ok && (!best || t0 < best.dist)) best = { mob: m, dist: t0 };
    }
    return best;
  }

  /** 攻击:扣血、红闪、朝攻击方向击退并逃窜,归零即死 */
  hurt(hit: MobHit, dir: THREE.Vector3): void {
    this.damage(hit.mob, 1, dir.x, dir.z, 6, 4.4);
  }

  /** 爆炸波及:距离决定伤害,从爆心向外击退 */
  applyExplosion(cx: number, cy: number, cz: number, radius: number): void {
    for (const m of [...this.list]) {
      const b = m.body;
      const dx = b.pos.x - cx;
      const dy = b.pos.y + b.height * 0.5 - cy;
      const dz = b.pos.z - cz;
      const dist = Math.max(0.4, Math.hypot(dx, dy, dz));
      const dmg = explosionDamage(dist, radius);
      if (dmg <= 0) continue;
      this.damage(m, dmg, dx / dist, dz / dist, 9, 6.5);
    }
  }

  private damage(
    m: Mob,
    dmg: number,
    dirX: number,
    dirZ: number,
    knock: number,
    knockUp: number,
  ): void {
    m.hp -= dmg;
    m.flash = 0.22;
    const b = m.body;
    b.vel.x += dirX * knock;
    b.vel.z += dirZ * knock;
    b.vel.y = Math.max(b.vel.y, knockUp);
    m.mode = 'flee';
    m.timer = 1.2;
    b.moving = true;
    b.speed = SPECIES[m.kind].flee;
    b.heading = Math.atan2(-dirX, -dirZ); // 沿冲击方向逃离
    if (m.hp <= 0) {
      this.onDeath?.(m.kind, b.pos.x, b.pos.y + 0.4, b.pos.z);
      const i = this.list.indexOf(m);
      if (i >= 0) this.removeAt(i);
    }
  }

  setBrightness(bright: number): void {
    this.brightness = bright;
  }

  /** 清空全部生物(测试用) */
  clear(): void {
    for (let i = this.list.length - 1; i >= 0; i--) this.removeAt(i);
  }

  private removeAt(i: number): void {
    const m = this.list[i];
    this.group.remove(m.group);
    for (const mat of m.mats) mat.dispose();
    this.list.splice(i, 1);
  }
}
