// 实体层 · 点燃的 TNT:引信闪烁、悬空下落、爆炸(方块清除 + 生物波及 +
// 玩家击退 + 连锁引爆)。第一个跑在 EntityManager 上的实体。
import * as THREE from 'three';
import { buildBlockGeometry } from '../blockmesh';
import { Block } from '../blocks';
import type { EventBus } from '../core/events';
import type { Entity, EntityManager } from './entities';
import type { Mobs } from '../mobs';
import type { Particles } from '../particles';
import type { Player } from '../player';
import type { Sound } from '../sound';
import type { World } from '../world';

export interface TntDeps {
  scene: THREE.Scene;
  world: World;
  mobs: Mobs;
  player: Player;
  sound: Sound;
  particles: Particles;
  events: EventBus;
  entities: EntityManager;
  /** 爆炸震屏(view.shake 并入) */
  onShake(strength: number): void;
  /** 宝箱被炸毁:main 接线溢出内容物为掉落物并关闭可能开着的面板 */
  onChestDestroyed?(x: number, y: number, z: number): void;
}

const RADIUS = 3.6;

export class TntSystem {
  private readonly geo = buildBlockGeometry(Block.TNT, 0.98);
  private readonly atlasMat: THREE.MeshBasicMaterial;

  constructor(
    private readonly deps: TntDeps,
    atlas: THREE.Texture,
  ) {
    this.atlasMat = new THREE.MeshBasicMaterial({ map: atlas });
  }

  /** 点燃:方块转为闪烁实体,引信到点起爆 */
  ignite(x: number, y: number, z: number, fuse = 2.2): void {
    this.deps.world.setBlock(x, y, z, Block.Air);
    this.deps.entities.add(new PrimedTnt(this, x, y, z, fuse));
    this.deps.sound.fuse();
  }

  makeMesh(): { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial } {
    const mat = this.atlasMat.clone();
    return { mesh: new THREE.Mesh(this.geo, mat), mat };
  }

  detonate(c: THREE.Vector3): void {
    const { world, mobs, player, sound, particles, events } = this.deps;
    const removed = world.explode(Math.floor(c.x), Math.floor(c.y), Math.floor(c.z), RADIUS);
    mobs.applyExplosion(c.x, c.y, c.z, RADIUS); // 生物也被波及
    // 碎屑:取一部分被毁方块喷粒子
    let budget = 90;
    for (const [x, y, z, id] of removed) {
      if (id === Block.TNT) {
        // 连锁引爆:短引信
        this.ignite(x, y, z, 0.25 + Math.random() * 0.5);
        continue;
      }
      if (id === Block.Chest) this.deps.onChestDestroyed?.(x, y, z); // 内容物溢出
      if (budget > 0) {
        particles.burst(x, y, z, id, 2);
        budget -= 2;
      }
    }
    // 玩家击退 + 震屏 + 音效按距离衰减
    const toPlayer = new THREE.Vector3(
      player.pos.x - c.x,
      player.pos.y + 0.9 - c.y,
      player.pos.z - c.z,
    );
    const dist = Math.max(toPlayer.length(), 0.5);
    if (dist < 10) {
      const strength = (1 - dist / 10) * 13;
      toPlayer.normalize();
      player.vel.x += toPlayer.x * strength;
      player.vel.y += toPlayer.y * strength * 0.5 + strength * 0.35;
      player.vel.z += toPlayer.z * strength;
    }
    this.deps.onShake(Math.min(1, 14 / (dist * dist + 4)));
    sound.explode(Math.max(0.15, Math.min(1, 1 - dist / 42)));
    events.emit('explosion', { x: c.x, y: c.y, z: c.z, radius: RADIUS });
  }

  isSolidBelow(x: number, y: number, z: number): boolean {
    return this.deps.world.isSolid(Math.floor(x), Math.floor(y), Math.floor(z));
  }

  removeMesh(mesh: THREE.Mesh): void {
    this.deps.scene.remove(mesh);
  }

  addMesh(mesh: THREE.Mesh): void {
    this.deps.scene.add(mesh);
  }
}

class PrimedTnt implements Entity {
  private readonly mesh: THREE.Mesh;
  private readonly mat: THREE.MeshBasicMaterial;
  private vy = 0;
  private brightness = 1;

  constructor(
    private readonly sys: TntSystem,
    x: number,
    y: number,
    z: number,
    private fuse: number,
  ) {
    const { mesh, mat } = sys.makeMesh();
    this.mesh = mesh;
    this.mat = mat;
    mesh.position.set(x + 0.5, y + 0.49, z + 0.5);
    sys.addMesh(mesh);
  }

  setBrightness(b: number): void {
    this.brightness = b;
  }

  update(dt: number): boolean {
    this.fuse -= dt;
    // 简单下落:悬空的点燃 TNT 会掉下去
    this.vy -= 24 * dt;
    let ny = this.mesh.position.y + this.vy * dt;
    if (this.vy < 0 && this.sys.isSolidBelow(this.mesh.position.x, ny - 0.49, this.mesh.position.z)) {
      ny = Math.floor(ny - 0.49) + 1.49;
      this.vy = 0;
    }
    this.mesh.position.y = ny;
    // 白闪加速 + 临爆膨胀
    const rate = this.fuse < 0.7 ? 0.12 : 0.3;
    const flash = Math.floor(this.fuse / rate) % 2 === 0;
    this.mat.color.setScalar(flash ? 2.4 : this.brightness);
    if (this.fuse < 0.35) {
      const s = 1 + (0.35 - this.fuse) * 0.5;
      this.mesh.scale.setScalar(s);
    }
    if (this.fuse <= 0) {
      this.sys.detonate(this.mesh.position);
      return false;
    }
    return true;
  }

  dispose(): void {
    this.sys.removeMesh(this.mesh);
    this.mat.dispose();
  }
}
