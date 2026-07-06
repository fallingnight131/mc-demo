// 世界:区块管理、按需流式生成/网格化、方块读写、体素射线检测
import * as THREE from 'three';
import { Block, BLOCK_DEFS, isWater, lightLevel } from './blocks';
import { Lights } from './lights';
import { buildChunkGeometry, Chunk } from './chunk';
import {
  CHUNK_SIZE,
  DATA_DISTANCE,
  RENDER_DISTANCE,
  SEED,
  UNLOAD_DISTANCE,
  WORLD_HEIGHT,
} from './config';
import { WaterSim } from './water';
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

/** 存档中的编辑记录:区块键 → [格子索引, 方块id][] */
export type EditData = Record<string, Array<[number, number]>>;

export class World {
  readonly gen: Generator;
  readonly group = new THREE.Group();
  readonly water = new WaterSim(this);
  /** 块光照(火把/萤石),不透明方块遮挡 */
  readonly lights = new Lights((x, y, z) => BLOCK_DEFS[this.getBlock(x, y, z)].opaque);
  /** 任意格子数据变化后的回调(重力方块唤醒等) */
  onBlockChanged: ((x: number, y: number, z: number) => void) | null = null;
  private lightDirty = false;
  /** 玩家编辑覆盖层:区块卸载重生成后回放,亦用于存档 */
  private readonly edits = new Map<string, Map<number, number>>();
  editsDirty = false;
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
    const dirty = new Set<Chunk>();
    if (!this.setRaw(x, y, z, id, dirty)) return;
    this.recordEdit(x, y, z, id);
    this.remeshChunks(dirty);
    this.water.wakeAround(x, y, z);
  }

  private recordEdit(x: number, y: number, z: number, id: number): void {
    const cx = Math.floor(x / CS);
    const cz = Math.floor(z / CS);
    const k = this.key(cx, cz);
    let m = this.edits.get(k);
    if (!m) {
      m = new Map();
      this.edits.set(k, m);
    }
    m.set((y * CS + (z - cz * CS)) * CS + (x - cx * CS), id);
    this.editsDirty = true;
  }

  /** 序列化编辑记录(存档用) */
  serializeEdits(): EditData {
    const out: EditData = {};
    for (const [k, m] of this.edits) {
      out[k] = [...m.entries()];
    }
    return out;
  }

  /** 载入编辑记录,必须在生成任何区块(warmup)之前调用 */
  loadEdits(data: EditData): void {
    for (const [k, list] of Object.entries(data)) {
      this.edits.set(k, new Map(list));
      // 恢复玩家放置的光源(全局登记,与区块加载无关)
      const [cx, cz] = k.split(',').map(Number);
      for (const [idx, id] of list) {
        if (lightLevel(id) > 0) {
          const lx = idx % CS;
          const lz = Math.floor(idx / CS) % CS;
          const y = Math.floor(idx / (CS * CS));
          this.lights.addSource(cx * CS + lx, y, cz * CS + lz, lightLevel(id));
          this.lightDirty = true;
        }
      }
    }
  }

  /** 只写数据并收集待重建区块,不触发网格重建(供水流模拟批量使用) */
  setRaw(x: number, y: number, z: number, id: number, dirty: Set<Chunk>): boolean {
    if (y < 0 || y >= WH) return false;
    const cx = Math.floor(x / CS);
    const cz = Math.floor(z / CS);
    const c = this.chunks.get(this.key(cx, cz));
    if (!c) return false;
    const lx = x - cx * CS;
    const lz = z - cz * CS;
    const old = c.get(lx, y, lz);
    if (old === id) return false;
    c.set(lx, y, lz, id);
    dirty.add(c);
    // 光照登记:光源增删,或不透明性变化且在某个光源范围内
    if (lightLevel(old) > 0) {
      this.lights.removeSource(x, y, z);
      this.lightDirty = true;
    }
    if (lightLevel(id) > 0) {
      this.lights.addSource(x, y, z, lightLevel(id));
      this.lightDirty = true;
    }
    if (
      !this.lightDirty &&
      BLOCK_DEFS[old].opaque !== BLOCK_DEFS[id].opaque &&
      this.lights.affectedBy(x, y, z)
    ) {
      this.lightDirty = true;
    }
    // 边界方块同时重建相邻区块,消除暴露面
    if (lx === 0) this.addIfPresent(cx - 1, cz, dirty);
    if (lx === CS - 1) this.addIfPresent(cx + 1, cz, dirty);
    if (lz === 0) this.addIfPresent(cx, cz - 1, dirty);
    if (lz === CS - 1) this.addIfPresent(cx, cz + 1, dirty);
    this.onBlockChanged?.(x, y, z);
    return true;
  }

  remeshChunks(dirty: Set<Chunk>): void {
    this.flushLight(dirty);
    for (const c of dirty) {
      if (c.meshed) this.rebuildMesh(c);
    }
  }

  /** 光照重算并把受影响格子的区块并入待重建集合 */
  private flushLight(dirty: Set<Chunk>): void {
    if (!this.lightDirty) return;
    this.lightDirty = false;
    for (const [x, , z] of this.lights.recompute()) {
      const cx = Math.floor(x / CS);
      const cz = Math.floor(z / CS);
      this.addIfPresent(cx, cz, dirty);
      const lx = x - cx * CS;
      const lz = z - cz * CS;
      if (lx === 0) this.addIfPresent(cx - 1, cz, dirty);
      if (lx === CS - 1) this.addIfPresent(cx + 1, cz, dirty);
      if (lz === 0) this.addIfPresent(cx, cz - 1, dirty);
      if (lz === CS - 1) this.addIfPresent(cx, cz + 1, dirty);
    }
  }

  /**
   * 爆炸:清除半径内的方块(保留基岩与水),边缘随机化更自然。
   * 返回被摧毁的方块列表 [x, y, z, id],供连锁引爆与粒子使用。
   */
  explode(cx: number, cy: number, cz: number, radius: number): Array<[number, number, number, number]> {
    const removed: Array<[number, number, number, number]> = [];
    const dirty = new Set<Chunk>();
    const r = Math.ceil(radius);
    const r2 = radius * radius;
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dz = -r; dz <= r; dz++) {
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > r2 * (0.72 + Math.random() * 0.42)) continue;
          const x = cx + dx;
          const y = cy + dy;
          const z = cz + dz;
          const id = this.getBlock(x, y, z);
          if (id === Block.Air || id === Block.Bedrock || id === Block.Obsidian || isWater(id)) {
            continue; // 黑曜石与基岩一样抗爆
          }
          if (this.setRaw(x, y, z, Block.Air, dirty)) {
            removed.push([x, y, z, id]);
            this.recordEdit(x, y, z, Block.Air);
            this.water.wakeAround(x, y, z);
          }
        }
      }
    }
    this.remeshChunks(dirty);
    return removed;
  }

  private addIfPresent(cx: number, cz: number, dirty: Set<Chunk>): void {
    const c = this.chunks.get(this.key(cx, cz));
    if (c) dirty.add(c);
  }

  private ensureData(cx: number, cz: number): Chunk {
    const k = this.key(cx, cz);
    let c = this.chunks.get(k);
    if (!c) {
      c = new Chunk(cx, cz, this.gen.generateChunk(cx, cz));
      this.chunks.set(k, c);
      // 回放该区块的玩家编辑,并唤醒水流以重新收敛(挖开的湖岸等)
      const m = this.edits.get(k);
      if (m) {
        for (const [idx, id] of m) {
          c.data[idx] = id;
          const y = Math.floor(idx / (CS * CS));
          const lz = Math.floor(idx / CS) % CS;
          const lx = idx % CS;
          this.water.wakeAround(cx * CS + lx, y, cz * CS + lz);
        }
      }
      this.scanChunkLights(c, true);
    }
    return c;
  }

  /**
   * 登记/注销区块内世界生成的光源(地标里的萤石等)。
   * 玩家放置的光源走编辑通道全局登记(与区块装卸无关),这里跳过,
   * 避免卸载时把它们误注销。
   */
  private scanChunkLights(c: Chunk, add: boolean): void {
    const m = this.edits.get(this.key(c.cx, c.cz));
    const data = c.data;
    for (let i = 0; i < data.length; i++) {
      const lv = lightLevel(data[i]);
      if (lv === 0) continue;
      if (m !== undefined && m.get(i) === data[i]) continue; // 玩家放置,全局常驻
      const y = Math.floor(i / (CS * CS));
      const lz = Math.floor(i / CS) % CS;
      const lx = i % CS;
      if (add) this.lights.addSource(c.cx * CS + lx, y, c.cz * CS + lz, lv);
      else this.lights.removeSource(c.cx * CS + lx, y, c.cz * CS + lz);
      this.lightDirty = true;
    }
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
    const geo = buildChunkGeometry(
      c,
      (x, y, z) => this.getBlock(x, y, z),
      (x, y, z) => this.lights.lightAt(x, y, z),
    );
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
    if (this.lightDirty) {
      this.lightDirty = false;
      this.lights.recompute(); // 网格尚未建,直接刷新光照数据即可
    }
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        this.rebuildMesh(this.ensureData(cx + dx, cz + dz));
      }
    }
  }

  /** 每帧调用:水流模拟 + 限额推进数据生成与网格化,玩家跨区块时卸载远处 */
  update(px: number, pz: number, dt = 0): void {
    this.water.update(dt);
    const pcx = Math.floor(px / CS);
    const pcz = Math.floor(pz / CS);

    if (pcx !== this.lastCX || pcz !== this.lastCZ) {
      this.lastCX = pcx;
      this.lastCZ = pcz;
      for (const [k, c] of this.chunks) {
        const d = Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz));
        if (d > UNLOAD_DISTANCE) {
          this.scanChunkLights(c, false);
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

    // 流式加载/卸载改变了生成光源 → 冲洗光照并重建受影响网格
    if (this.lightDirty) {
      const dirty = new Set<Chunk>();
      this.flushLight(dirty);
      for (const c of dirty) {
        if (c.meshed) this.rebuildMesh(c);
      }
    }
  }

  /** Amanatides & Woo 体素遍历;命中第一个可交互方块(忽略空气与水,火把可命中) */
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
      // 可交互即命中:固体方块 + 非碰撞的火把等(忽略空气与水)
      if (id !== Block.Air && !isWater(id)) {
        return { x, y, z, nx, ny, nz, id };
      }
    }
    return null;
  }
}
