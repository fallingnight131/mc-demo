// 世界:区块管理、按需流式生成/网格化、方块读写、体素射线检测
import * as THREE from 'three';
import { Block, BLOCK_DEFS } from './blocks';
import { buildChunkGeometry, Chunk } from './chunk';
import {
  CHUNK_SIZE,
  DATA_DISTANCE,
  RENDER_DISTANCE,
  SEED,
  UNLOAD_DISTANCE,
  WORLD_HEIGHT,
} from './config';
import { Generator } from './worldgen';

const CS = CHUNK_SIZE;
const WH = WORLD_HEIGHT;

export interface RayHit {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  id: number;
}

export class World {
  readonly gen: Generator;
  readonly group = new THREE.Group();
  private readonly chunks = new Map<string, Chunk>();
  private readonly offsets: Array<[number, number]>; // 按距离升序的环形偏移
  private lastCX = Number.NaN;
  private lastCZ = Number.NaN;

  constructor(
    private readonly solidMat: THREE.Material,
    private readonly waterMat: THREE.Material,
    seed = SEED,
  ) {
    this.gen = new Generator(seed);
    this.offsets = [];
    for (let dx = -DATA_DISTANCE; dx <= DATA_DISTANCE; dx++) {
      for (let dz = -DATA_DISTANCE; dz <= DATA_DISTANCE; dz++) {
        this.offsets.push([dx, dz]);
      }
    }
    this.offsets.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
  }

  private key(cx: number, cz: number): string {
    return cx + ',' + cz;
  }

  getChunk(cx: number, cz: number): Chunk | undefined {
    return this.chunks.get(this.key(cx, cz));
  }

  getBlock(x: number, y: number, z: number): number {
    if (y < 0 || y >= WH) return Block.Air;
    const cx = Math.floor(x / CS);
    const cz = Math.floor(z / CS);
    const c = this.chunks.get(this.key(cx, cz));
    if (!c) return Block.Air;
    return c.get(x - cx * CS, y, z - cz * CS);
  }

  /** 碰撞查询:未加载区块视为实心,防止穿入未生成地形 */
  isSolid(x: number, y: number, z: number): boolean {
    if (y < 0) return true;
    if (y >= WH) return false;
    const cx = Math.floor(x / CS);
    const cz = Math.floor(z / CS);
    const c = this.chunks.get(this.key(cx, cz));
    if (!c) return true;
    return BLOCK_DEFS[c.get(x - cx * CS, y, z - cz * CS)].solid;
  }

  setBlock(x: number, y: number, z: number, id: number): void {
    if (y < 0 || y >= WH) return;
    const cx = Math.floor(x / CS);
    const cz = Math.floor(z / CS);
    const c = this.chunks.get(this.key(cx, cz));
    if (!c) return;
    const lx = x - cx * CS;
    const lz = z - cz * CS;
    c.set(lx, y, lz, id);
    this.rebuildMesh(c);
    // 边界方块同时重建相邻区块,消除暴露面
    if (lx === 0) this.rebuildIfMeshed(cx - 1, cz);
    if (lx === CS - 1) this.rebuildIfMeshed(cx + 1, cz);
    if (lz === 0) this.rebuildIfMeshed(cx, cz - 1);
    if (lz === CS - 1) this.rebuildIfMeshed(cx, cz + 1);
  }

  private rebuildIfMeshed(cx: number, cz: number): void {
    const c = this.chunks.get(this.key(cx, cz));
    if (c && c.meshed) this.rebuildMesh(c);
  }

  private ensureData(cx: number, cz: number): Chunk {
    const k = this.key(cx, cz);
    let c = this.chunks.get(k);
    if (!c) {
      c = new Chunk(cx, cz, this.gen.generateChunk(cx, cz));
      this.chunks.set(k, c);
    }
    return c;
  }

  private hasData(cx: number, cz: number): boolean {
    return this.chunks.has(this.key(cx, cz));
  }

  private neighborsReady(cx: number, cz: number): boolean {
    return (
      this.hasData(cx - 1, cz) &&
      this.hasData(cx + 1, cz) &&
      this.hasData(cx, cz - 1) &&
      this.hasData(cx, cz + 1)
    );
  }

  private disposeMeshes(c: Chunk): void {
    if (c.solidMesh) {
      this.group.remove(c.solidMesh);
      c.solidMesh.geometry.dispose();
      c.solidMesh = null;
    }
    if (c.waterMesh) {
      this.group.remove(c.waterMesh);
      c.waterMesh.geometry.dispose();
      c.waterMesh = null;
    }
  }

  private rebuildMesh(c: Chunk): void {
    this.disposeMeshes(c);
    const geo = buildChunkGeometry(c, (x, y, z) => this.getBlock(x, y, z));
    if (geo.solid) {
      c.solidMesh = new THREE.Mesh(geo.solid, this.solidMat);
      this.group.add(c.solidMesh);
    }
    if (geo.water) {
      c.waterMesh = new THREE.Mesh(geo.water, this.waterMat);
      this.group.add(c.waterMesh);
    }
    c.meshed = true;
  }

  /** 同步生成出生点附近的最小可玩区域 */
  warmup(cx: number, cz: number): void {
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        this.ensureData(cx + dx, cz + dz);
      }
    }
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        this.rebuildMesh(this.ensureData(cx + dx, cz + dz));
      }
    }
  }

  /** 每帧调用:限额推进数据生成与网格化,玩家跨区块时卸载远处 */
  update(px: number, pz: number): void {
    const pcx = Math.floor(px / CS);
    const pcz = Math.floor(pz / CS);

    if (pcx !== this.lastCX || pcz !== this.lastCZ) {
      this.lastCX = pcx;
      this.lastCZ = pcz;
      for (const [k, c] of this.chunks) {
        const d = Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz));
        if (d > UNLOAD_DISTANCE) {
          this.disposeMeshes(c);
          this.chunks.delete(k);
        }
      }
    }

    let dataBudget = 4;
    let meshBudget = 2;
    for (const [dx, dz] of this.offsets) {
      if (dataBudget <= 0 && meshBudget <= 0) break;
      const cx = pcx + dx;
      const cz = pcz + dz;
      const cheb = Math.max(Math.abs(dx), Math.abs(dz));
      const c = this.chunks.get(this.key(cx, cz));
      if (!c) {
        if (dataBudget > 0) {
          this.ensureData(cx, cz);
          dataBudget--;
        }
        continue;
      }
      if (
        !c.meshed &&
        cheb <= RENDER_DISTANCE &&
        meshBudget > 0 &&
        this.neighborsReady(cx, cz)
      ) {
        this.rebuildMesh(c);
        meshBudget--;
      }
    }
  }

  /** Amanatides & Woo 体素遍历;命中第一个固体方块(忽略水) */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): RayHit | null {
    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);

    const stepX = dir.x > 0 ? 1 : dir.x < 0 ? -1 : 0;
    const stepY = dir.y > 0 ? 1 : dir.y < 0 ? -1 : 0;
    const stepZ = dir.z > 0 ? 1 : dir.z < 0 ? -1 : 0;

    const tDeltaX = stepX !== 0 ? Math.abs(1 / dir.x) : Infinity;
    const tDeltaY = stepY !== 0 ? Math.abs(1 / dir.y) : Infinity;
    const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dir.z) : Infinity;

    let tMaxX = stepX > 0 ? (x + 1 - origin.x) / dir.x : stepX < 0 ? (x - origin.x) / dir.x : Infinity;
    let tMaxY = stepY > 0 ? (y + 1 - origin.y) / dir.y : stepY < 0 ? (y - origin.y) / dir.y : Infinity;
    let tMaxZ = stepZ > 0 ? (z + 1 - origin.z) / dir.z : stepZ < 0 ? (z - origin.z) / dir.z : Infinity;

    let t = 0;
    let nx = 0;
    let ny = 0;
    let nz = 0;

    for (let i = 0; i < 512; i++) {
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX;
        t = tMaxX;
        tMaxX += tDeltaX;
        nx = -stepX;
        ny = 0;
        nz = 0;
      } else if (tMaxY < tMaxZ) {
        y += stepY;
        t = tMaxY;
        tMaxY += tDeltaY;
        nx = 0;
        ny = -stepY;
        nz = 0;
      } else {
        z += stepZ;
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        nx = 0;
        ny = 0;
        nz = -stepZ;
      }
      if (t > maxDist) return null;
      const id = this.getBlock(x, y, z);
      if (id !== Block.Air && id !== Block.Water && BLOCK_DEFS[id].solid) {
        return { x, y, z, nx, ny, nz, id };
      }
    }
    return null;
  }
}
