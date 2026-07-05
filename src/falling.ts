// 重力方块(沙子):下方失去支撑时变为下落实体,落到实体上变回方块。
// 链式:底部触发后,setBlock(Air) 经 onBlockChanged 回调自动唤醒上方。
import * as THREE from 'three';
import { BLOCK_DEFS } from './blocks';
import { buildBlockGeometry } from './blockmesh';
import type { World } from './world';

const MAX_FALLING = 64;
const GRAVITY = 22;

interface Falling {
  mesh: THREE.Mesh;
  id: number;
  x: number;
  z: number;
  y: number; // 方块底面高度(浮点)
  vy: number;
}

export class FallingBlocks {
  readonly group = new THREE.Group();
  /** 方块落定回调(音效用) */
  onLand: ((x: number, y: number, z: number, id: number) => void) | null = null;
  private readonly list: Falling[] = [];
  private readonly material: THREE.MeshBasicMaterial;
  private readonly geoCache = new Map<number, THREE.BufferGeometry>();

  constructor(atlas: THREE.Texture, private readonly world: World) {
    this.material = new THREE.MeshBasicMaterial({ map: atlas, alphaTest: 0.5 });
  }

  get count(): number {
    return this.list.length;
  }

  setBrightness(b: number): void {
    this.material.color.setScalar(b);
  }

  /** 方块变化后调用:该格若是悬空的重力方块则开始下落 */
  wake(x: number, y: number, z: number): void {
    const id = this.world.getBlock(x, y, z);
    if (!BLOCK_DEFS[id].gravity) return;
    if (this.world.isSolid(x, y - 1, z)) return; // 有支撑
    if (this.list.length >= MAX_FALLING) return;
    // 变为下落实体(setBlock 会触发回调,链式唤醒上方的沙)
    this.world.setBlock(x, y, z, 0);
    let geo = this.geoCache.get(id);
    if (!geo) {
      geo = buildBlockGeometry(id, 1);
      this.geoCache.set(id, geo);
    }
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
    this.group.add(mesh);
    this.list.push({ mesh, id, x, z, y, vy: 0 });
  }

  update(dt: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      f.vy -= GRAVITY * dt;
      let ny = f.y + f.vy * dt;
      // 底面进入实体方块 → 落定在其顶面
      const cellBelow = Math.floor(ny - 0.001);
      if (this.world.isSolid(f.x, cellBelow, f.z)) {
        const restY = cellBelow + 1;
        this.group.remove(f.mesh);
        this.list.splice(i, 1);
        this.world.setBlock(f.x, restY, f.z, f.id);
        this.onLand?.(f.x, restY, f.z, f.id);
        continue;
      }
      if (ny < -12) {
        // 跌出世界,消失
        this.group.remove(f.mesh);
        this.list.splice(i, 1);
        continue;
      }
      f.y = ny;
      f.mesh.position.y = ny + 0.5;
    }
  }
}
