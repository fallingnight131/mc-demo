// 区块数据与网格构建:逐方块面剔除,顶点色做朝向明暗,UV 采样纹理图集
import * as THREE from 'three';
import { Block, BLOCK_DEFS, isWater, tileUV, waterLevel } from './blocks';
import { CHUNK_SIZE, WORLD_HEIGHT } from './config';

const CS = CHUNK_SIZE;
const WH = WORLD_HEIGHT;

export class Chunk {
  readonly cx: number;
  readonly cz: number;
  readonly data: Uint8Array;
  solidMesh: THREE.Mesh | null = null;
  waterMesh: THREE.Mesh | null = null;
  meshed = false;

  constructor(cx: number, cz: number, data: Uint8Array) {
    this.cx = cx;
    this.cz = cz;
    this.data = data;
  }

  get(lx: number, y: number, lz: number): number {
    return this.data[(y * CS + lz) * CS + lx];
  }

  set(lx: number, y: number, lz: number, id: number): void {
    this.data[(y * CS + lz) * CS + lx] = id;
  }
}

interface FaceDef {
  dx: number;
  dy: number;
  dz: number;
  corners: ReadonlyArray<readonly [number, number, number]>; // CCW,从面外侧看
  brightness: number;
  tileIndex: number; // BlockDef.tiles 中的下标
}

// 顶点顺序:侧面前两个为底部 (y=0)、后两个为顶部 (y=1),与 UV 赋值约定一致
const FACES: FaceDef[] = [
  { dx: 1, dy: 0, dz: 0, corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], brightness: 0.65, tileIndex: 0 },
  { dx: -1, dy: 0, dz: 0, corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], brightness: 0.65, tileIndex: 1 },
  { dx: 0, dy: 1, dz: 0, corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], brightness: 1.0, tileIndex: 2 },
  { dx: 0, dy: -1, dz: 0, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], brightness: 0.55, tileIndex: 3 },
  { dx: 0, dy: 0, dz: 1, corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], brightness: 0.82, tileIndex: 4 },
  { dx: 0, dy: 0, dz: -1, corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], brightness: 0.82, tileIndex: 5 },
];

// 各水位等级的水面下沉量(等级 4..1),索引 = 等级
const WATER_DROPS = [0, 0.7, 0.52, 0.34, 0.14];

class GeoArrays {
  positions: number[] = [];
  colors: number[] = [];
  uvs: number[] = [];
  lights: number[] = []; // 每顶点块光(0..1),着色器中 max(昼夜, 块光)
  indices: number[] = [];

  toGeometry(): THREE.BufferGeometry | null {
    if (this.indices.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute('aLight', new THREE.Float32BufferAttribute(this.lights, 1));
    g.setIndex(this.indices);
    g.computeBoundingSphere();
    return g;
  }
}

export interface ChunkGeometry {
  solid: THREE.BufferGeometry | null;
  water: THREE.BufferGeometry | null;
}

/**
 * 构建区块几何体。getWorldBlock 用于跨区块边界查询邻居,
 * 调用前需保证四个水平相邻区块的数据已生成。
 */
export function buildChunkGeometry(
  chunk: Chunk,
  getWorldBlock: (x: number, y: number, z: number) => number,
  getLight: (x: number, y: number, z: number) => number = () => 0,
): ChunkGeometry {
  const ox = chunk.cx * CS;
  const oz = chunk.cz * CS;
  const data = chunk.data;

  const blockAt = (lx: number, y: number, lz: number): number => {
    if (y < 0) return Block.Bedrock;
    if (y >= WH) return Block.Air;
    if (lx >= 0 && lx < CS && lz >= 0 && lz < CS) return data[(y * CS + lz) * CS + lx];
    return getWorldBlock(ox + lx, y, oz + lz);
  };

  const solid = new GeoArrays();
  const water = new GeoArrays();

  for (let y = 0; y < WH; y++) {
    for (let lz = 0; lz < CS; lz++) {
      for (let lx = 0; lx < CS; lx++) {
        const id = data[(y * CS + lz) * CS + lx];
        if (id === Block.Air) continue;
        const def = BLOCK_DEFS[id];
        const tiles = def.tiles!;
        const blockIsWater = isWater(id);
        const target = blockIsWater ? water : solid;

        // 十字面片(火把):两张对角面各双面,取本格光值,不参与面剔除
        if (def.shape === 'cross') {
          const { u0, v0, u1, v1 } = tileUV(tiles[0]);
          const lv = Math.max(getLight(ox + lx, y, oz + lz) / 15, 0.9); // 火把自体常亮
          const quads: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
            [[0.15, 0.15], [0.85, 0.85]],
            [[0.15, 0.85], [0.85, 0.15]],
          ];
          for (const [[x0, z0], [x1, z1]] of quads) {
            for (const flip of [false, true]) {
              const base = solid.positions.length / 3;
              const pa: [number, number][] = flip
                ? [[x1, z1], [x0, z0]]
                : [[x0, z0], [x1, z1]];
              solid.positions.push(
                ox + lx + pa[0][0], y, oz + lz + pa[0][1],
                ox + lx + pa[1][0], y, oz + lz + pa[1][1],
                ox + lx + pa[1][0], y + 1, oz + lz + pa[1][1],
                ox + lx + pa[0][0], y + 1, oz + lz + pa[0][1],
              );
              for (let i = 0; i < 4; i++) {
                solid.colors.push(1, 1, 1);
                solid.lights.push(lv);
              }
              solid.uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
              solid.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
            }
          }
          continue;
        }
        // 水面按水位下沉;若上方也是水(瀑布柱)则保持满格不留缝
        const topDrop =
          blockIsWater && !isWater(blockAt(lx, y + 1, lz))
            ? WATER_DROPS[waterLevel(id)]
            : 0;

        for (const f of FACES) {
          const n = blockAt(lx + f.dx, y + f.dy, lz + f.dz);
          // 同类相邻面剔除:任意水之间、相同方块之间(玻璃-玻璃)
          if (blockIsWater ? isWater(n) : n === id) continue;
          if (BLOCK_DEFS[n].opaque) continue;

          // 水使用独立贴图(全 [0,1] UV),其余方块采样图集
          const { u0, v0, u1, v1 } = blockIsWater
            ? { u0: 0, v0: 0, u1: 1, v1: 1 }
            : tileUV(tiles[f.tileIndex]);
          const base = target.positions.length / 3;

          // 面外侧格子的块光,烘进顶点;自发光方块(岩浆/地狱石)取 glow 下限
          const faceLight = Math.max(
            getLight(ox + lx + f.dx, y + f.dy, oz + lz + f.dz) / 15,
            def.glow ?? 0,
          );
          for (let i = 0; i < 4; i++) {
            const c = f.corners[i];
            // 顶部顶点统一下沉,侧面随之变矮,避免侧壁高出水面
            const py = c[1] === 1 ? y + 1 - topDrop : y;
            target.positions.push(ox + lx + c[0], py, oz + lz + c[2]);
            const b = f.brightness;
            target.colors.push(b, b, b);
            target.lights.push(faceLight * f.brightness);
          }
          target.uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
          target.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
    }
  }

  return { solid: solid.toGeometry(), water: water.toGeometry() };
}
