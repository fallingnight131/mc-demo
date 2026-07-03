// 掉落物:破坏方块后掉出的小方块实体,旋转、受重力、靠近自动吸附拾取
import * as THREE from 'three';
import { buildBlockGeometry } from './blockmesh';

const MAX_DROPS = 64;
const GRAVITY = 18;
const TTL = 30; // 秒,超时消失
const SIZE = 0.27;
const MAGNET_DIST = 1.7;
const PICKUP_DIST = 0.5;

interface GroundQuery {
  isSolid(x: number, y: number, z: number): boolean;
}

interface Drop {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  age: number;
  id: number;
}

export class ItemDrops {
  readonly group = new THREE.Group();
  /** 拾取回调(方块 id) */
  onPickup: ((id: number) => void) | null = null;
  private readonly drops: Drop[] = [];
  private readonly geoCache = new Map<number, THREE.BufferGeometry>();
  private readonly material: THREE.MeshBasicMaterial;

  constructor(atlas: THREE.Texture, private readonly world: GroundQuery) {
    this.material = new THREE.MeshBasicMaterial({ map: atlas });
  }

  get count(): number {
    return this.drops.length;
  }

  /** 昼夜亮度 */
  setBrightness(b: number): void {
    this.material.color.setScalar(b);
  }

  spawn(bx: number, by: number, bz: number, id: number): void {
    if (this.drops.length >= MAX_DROPS) this.remove(0); // 顶掉最旧的
    let geo = this.geoCache.get(id);
    if (!geo) {
      geo = buildBlockGeometry(id, SIZE);
      this.geoCache.set(id, geo);
    }
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.position.set(bx + 0.5, by + 0.4, bz + 0.5);
    this.group.add(mesh);
    this.drops.push({
      mesh,
      vel: new THREE.Vector3((Math.random() - 0.5) * 2, 2.5 + Math.random(), (Math.random() - 0.5) * 2),
      age: 0,
      id,
    });
  }

  update(dt: number, playerCenter: THREE.Vector3): void {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.age += dt;
      if (d.age > TTL) {
        this.remove(i);
        continue;
      }
      const p = d.mesh.position;

      // 磁吸与拾取
      const dx = playerCenter.x - p.x;
      const dy = playerCenter.y - p.y;
      const dz = playerCenter.z - p.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d.age > 0.5 && dist < PICKUP_DIST) {
        this.onPickup?.(d.id);
        this.remove(i);
        continue;
      }
      if (d.age > 0.5 && dist < MAGNET_DIST) {
        const pull = (1 - dist / MAGNET_DIST) * 30 * dt;
        d.vel.x += (dx / dist) * pull * 4;
        d.vel.y += (dy / dist) * pull * 4;
        d.vel.z += (dz / dist) * pull * 4;
      } else {
        d.vel.y -= GRAVITY * dt;
      }

      // 移动 + 地面碰撞
      let ny = p.y + d.vel.y * dt;
      if (
        d.vel.y < 0 &&
        this.world.isSolid(Math.floor(p.x), Math.floor(ny - SIZE / 2), Math.floor(p.z))
      ) {
        ny = Math.floor(ny - SIZE / 2) + 1 + SIZE / 2;
        d.vel.y = 0;
        d.vel.x *= 0.7;
        d.vel.z *= 0.7;
      }
      p.set(p.x + d.vel.x * dt, ny, p.z + d.vel.z * dt);

      // 旋转 + 落地后轻微浮动
      d.mesh.rotation.y = d.age * 2.2;
      if (d.vel.y === 0) {
        d.mesh.position.y += Math.sin(d.age * 3) * 0.02;
      }
    }
  }

  private remove(i: number): void {
    this.group.remove(this.drops[i].mesh);
    this.drops.splice(i, 1);
  }
}
