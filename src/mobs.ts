// 生物:僵尸(泰拉式夜间敌人)—— 盒子模型、夜间黑暗处生成、追击玩家、白天燃烧
import * as THREE from 'three';
import { Block, isWater } from './blocks';
import { buildMobTextures, type MobSkin } from './textures';

const MAX_MOBS = 8;
const SPAWN_NEAR = 18; // 生成距离范围(玩家周围环带)
const SPAWN_FAR = 42;
const DESPAWN_DIST = 90;
const GRAVITY = 24;
const HOP_SPEED = 7.2; // 遇 1 格台阶的小跳
const ARM_HANG = 0.22; // 泰拉僵尸双臂下垂微前伸的基准角(非 MC 的水平前伸)

export type MobKind = 'zombie';

interface SpeciesDef {
  hp: number;
  walk: number;
  flee: number;
  half: number; // 碰撞半宽
  height: number; // 碰撞高
  slowFall: boolean; // 鸡扑翼缓降
  hostile?: boolean; // 敌对:夜间黑暗处生成,追击玩家,白天燃烧
}

const SPECIES: Record<MobKind, SpeciesDef> = {
  zombie: { hp: 5, walk: 1.9, flee: 1.9, half: 0.3, height: 1.8, slowFall: false, hostile: true },
};

const CHASE_RANGE = 18; // 僵尸索敌距离
const ATTACK_RANGE = 1.5;
const ATTACK_COOLDOWN = 1.0;
const BURN_INTERVAL = 0.8; // 白天燃烧掉血间隔

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
  mode: 'idle' | 'walk' | 'flee' | 'chase';
  timer: number;
  voiceTimer: number;
  flash: number; // 受击红闪剩余时间
  phase: number; // 腿摆动相位
  displayHeading: number; // 平滑转身
  attackCd: number; // 攻击冷却(敌对)
  burnAcc: number; // 白天燃烧计时(敌对)
  group: THREE.Group;
  legs: THREE.Mesh[];
  legSign: number[]; // 每条腿的摆动相位符号
  arms: THREE.Mesh[]; // 人形双臂(僵尸前伸)
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
  /** 夜晚程度(0..1,主循环每帧设置):决定敌对生成与被动减产 */
  nightFactor = 0;
  /** 白天(亮度高):敌对生物燃烧 */
  daylight = false;
  /** 僵尸打中玩家:伤害与击退方向 */
  onAttack: ((dmg: number, dirX: number, dirZ: number) => void) | null = null;
  /** 燃烧中的敌对生物位置(白烟粒子) */
  onBurning: ((x: number, y: number, z: number) => void) | null = null;

  private readonly list: Mob[] = [];
  private readonly skins: Record<MobKind, MobSkin>;
  private readonly geoCache = new Map<string, THREE.BoxGeometry>();
  private spawnTimer = 0;
  private brightness = 1;

  constructor(
    private readonly world: MobWorldQuery,
    private readonly surfaceAt: (x: number, z: number) => number,
    private readonly lightAt: (x: number, y: number, z: number) => number = () => 0,
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
    arms: THREE.Mesh[];
    mats: THREE.MeshBasicMaterial[];
  } {
    const skin = this.skins[kind];
    const mat = (tex: THREE.Texture) => new THREE.MeshBasicMaterial({ map: tex });
    const bodyMat = mat(skin.body);
    const headMat = mat(skin.head);
    const faceMat = mat(skin.face);
    const hairMat = mat(skin.hair);
    const armMat = mat(skin.arm);
    const pantsMat = mat(skin.pants);
    const g = new THREE.Group();
    const legs: THREE.Mesh[] = [];
    const arms: THREE.Mesh[] = [];
    // 头顶(+y)与后脑(+z)整片乱发,脸在 -z,两侧与底面为皮肤
    const headMats = [headMat, headMat, hairMat, headMat, hairMat, faceMat];

    // 泰拉式僵尸:乱发脑袋 + 破衫躯干 + 下垂裸臂(蹒跚摆动)+ 破裤双腿,整体微前倾佝偻
    void kind;
    const head = new THREE.Mesh(this.box(0.44, 0.44, 0.44), headMats);
    head.position.set(0, 1.55, 0);
    head.rotation.x = 0.12; // 低头前探
    g.add(head);
    const body = new THREE.Mesh(this.box(0.42, 0.62, 0.22), bodyMat);
    body.position.y = 1.02;
    body.rotation.x = 0.07; // 佝偻
    g.add(body);
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(this.box(0.16, 0.64, 0.16, true), armMat);
      arm.position.set(side * 0.31, 1.34, 0);
      arm.rotation.set(ARM_HANG, 0, side * -0.08); // 下垂微前伸、略外张
      arms.push(arm);
      g.add(arm);
      const leg = new THREE.Mesh(this.box(0.18, 0.7, 0.18, true), pantsMat);
      leg.position.set(side * 0.11, 0.7, 0);
      legs.push(leg);
      g.add(leg);
    }
    const legSign = [1, -1];
    return {
      group: g,
      legs,
      legSign,
      arms,
      mats: [bodyMat, headMat, faceMat, hairMat, armMat, pantsMat],
    };
  }

  spawnAt(x: number, y: number, z: number, kind: MobKind = 'zombie'): void {
    const def = SPECIES[kind];
    const { group, legs, legSign, arms, mats } = this.buildModel(kind);
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
      attackCd: 0,
      burnAcc: 0,
      group,
      legs,
      legSign,
      arms,
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
    // 只有夜间的黑暗处才刷僵尸(泰拉之夜):被火把/萤石照亮(块光 ≥8)不刷
    if (this.nightFactor <= 0.5 || Math.random() >= 0.55) return;
    if (this.lightAt(x, h + 1, z) >= 8) return;
    this.spawnAt(x + 0.5, h + 1.01, z + 0.5, 'zombie');
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

      // 行为:敌对追击玩家;其余发呆 ↔ 漫步,受击后短暂逃窜
      const def = SPECIES[m.kind];
      m.attackCd = Math.max(0, m.attackCd - dt);
      if (def.hostile && dist < CHASE_RANGE) {
        m.mode = 'chase';
        b.heading = Math.atan2(-(playerPos.x - b.pos.x), -(playerPos.z - b.pos.z));
        b.speed = def.walk;
        b.moving = dist > ATTACK_RANGE * 0.7;
        if (dist < ATTACK_RANGE && m.attackCd <= 0) {
          m.attackCd = ATTACK_COOLDOWN;
          const dx = playerPos.x - b.pos.x;
          const dz = playerPos.z - b.pos.z;
          const dl = Math.max(0.2, Math.hypot(dx, dz));
          this.onAttack?.(2, dx / dl, dz / dl);
        }
      } else {
        if (m.mode === 'chase') {
          m.mode = 'idle';
          m.timer = 0.5;
          b.moving = false;
        }
        m.timer -= dt;
        if (m.timer <= 0) {
          if (m.mode === 'idle') {
            m.mode = 'walk';
            m.timer = 1.5 + Math.random() * 2.5;
            b.heading = Math.random() * Math.PI * 2;
            b.speed = def.walk;
            b.moving = true;
          } else {
            m.mode = 'idle';
            m.timer = 1 + Math.random() * 3;
            b.moving = false;
          }
        }
      }

      // 白天燃烧:敌对生物在日光下持续掉血冒白烟
      if (def.hostile && this.daylight) {
        m.burnAcc += dt;
        if (m.burnAcc >= BURN_INTERVAL) {
          m.burnAcc = 0;
          this.onBurning?.(b.pos.x, b.pos.y + 1, b.pos.z);
          m.hp -= 1;
          m.flash = 0.2;
          if (m.hp <= 0) {
            this.onDeath?.(m.kind, b.pos.x, b.pos.y + 0.4, b.pos.z);
            this.removeAt(i);
            continue;
          }
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
      // 下垂裸臂随蹒跚步伐前后摆(与同侧腿反相),始终垂着而非 MC 式水平前伸
      const armSwing = Math.sin(m.phase) * Math.min(1, hspeed / 2) * 0.7;
      m.arms[0].rotation.x = ARM_HANG - armSwing;
      m.arms[1].rotation.x = ARM_HANG + armSwing;
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

  /** 攻击:扣血、红闪、朝攻击方向击退并逃窜,归零即死(剑等武器伤害更高) */
  hurt(hit: MobHit, dir: THREE.Vector3, dmg = 1): void {
    this.damage(hit.mob, dmg, dir.x, dir.z, 6, 4.4);
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
    if (!SPECIES[m.kind].hostile) {
      m.mode = 'flee';
      m.timer = 1.2;
      b.moving = true;
      b.speed = SPECIES[m.kind].flee;
      b.heading = Math.atan2(-dirX, -dirZ); // 沿冲击方向逃离
    }
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
