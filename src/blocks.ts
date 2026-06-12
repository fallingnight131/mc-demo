// 方块与纹理图集定义(纯数据,不依赖 DOM)

export const ATLAS_COLS = 4;
export const ATLAS_ROWS = 4;
export const TILE_PX = 16;

// 图集中的纹理格索引
export const Tile = {
  GrassTop: 0,
  GrassSide: 1,
  Dirt: 2,
  Stone: 3,
  Sand: 4,
  LogSide: 5,
  LogTop: 6,
  Leaves: 7,
  Plank: 8,
  Cobble: 9,
  Bedrock: 10,
  Water: 11,
  Snow: 12,
  SnowSide: 13,
  Glass: 14,
} as const;

export const Block = {
  Air: 0,
  Grass: 1,
  Dirt: 2,
  Stone: 3,
  Sand: 4,
  Log: 5,
  Leaves: 6,
  Plank: 7,
  Cobble: 8,
  Bedrock: 9,
  Water: 10,
  Snow: 11,
  Glass: 12,
} as const;

export interface BlockDef {
  name: string;
  /** 六面纹理 [+x, -x, +y, -y, +z, -z],空气为 null */
  tiles: [number, number, number, number, number, number] | null;
  solid: boolean; // 是否参与碰撞
  opaque: boolean; // 是否完全遮挡相邻面
}

const T = Tile;
export const BLOCK_DEFS: BlockDef[] = [
  { name: '空气', tiles: null, solid: false, opaque: false },
  { name: '草方块', tiles: [T.GrassSide, T.GrassSide, T.GrassTop, T.Dirt, T.GrassSide, T.GrassSide], solid: true, opaque: true },
  { name: '泥土', tiles: [T.Dirt, T.Dirt, T.Dirt, T.Dirt, T.Dirt, T.Dirt], solid: true, opaque: true },
  { name: '石头', tiles: [T.Stone, T.Stone, T.Stone, T.Stone, T.Stone, T.Stone], solid: true, opaque: true },
  { name: '沙子', tiles: [T.Sand, T.Sand, T.Sand, T.Sand, T.Sand, T.Sand], solid: true, opaque: true },
  { name: '原木', tiles: [T.LogSide, T.LogSide, T.LogTop, T.LogTop, T.LogSide, T.LogSide], solid: true, opaque: true },
  { name: '树叶', tiles: [T.Leaves, T.Leaves, T.Leaves, T.Leaves, T.Leaves, T.Leaves], solid: true, opaque: true },
  { name: '木板', tiles: [T.Plank, T.Plank, T.Plank, T.Plank, T.Plank, T.Plank], solid: true, opaque: true },
  { name: '圆石', tiles: [T.Cobble, T.Cobble, T.Cobble, T.Cobble, T.Cobble, T.Cobble], solid: true, opaque: true },
  { name: '基岩', tiles: [T.Bedrock, T.Bedrock, T.Bedrock, T.Bedrock, T.Bedrock, T.Bedrock], solid: true, opaque: true },
  { name: '水', tiles: [T.Water, T.Water, T.Water, T.Water, T.Water, T.Water], solid: false, opaque: false },
  { name: '雪块', tiles: [T.SnowSide, T.SnowSide, T.Snow, T.Dirt, T.SnowSide, T.SnowSide], solid: true, opaque: true },
  { name: '玻璃', tiles: [T.Glass, T.Glass, T.Glass, T.Glass, T.Glass, T.Glass], solid: true, opaque: false },
];

/** 物品栏中可放置的方块(对应按键 1-9) */
export const PLACEABLE: number[] = [
  Block.Grass,
  Block.Dirt,
  Block.Stone,
  Block.Cobble,
  Block.Plank,
  Block.Log,
  Block.Leaves,
  Block.Sand,
  Block.Glass,
];

export interface TileUV {
  u0: number;
  v0: number;
  u1: number;
  v1: number; // v1 为纹理格顶部(适配 flipY 的画布纹理)
}

const UV_INSET = 0.0008; // 微小内缩,避免浮点误差采到相邻格

export function tileUV(t: number): TileUV {
  const col = t % ATLAS_COLS;
  const row = Math.floor(t / ATLAS_COLS);
  const du = 1 / ATLAS_COLS;
  const dv = 1 / ATLAS_ROWS;
  return {
    u0: col * du + UV_INSET,
    u1: (col + 1) * du - UV_INSET,
    v0: 1 - (row + 1) * dv + UV_INSET,
    v1: 1 - row * dv - UV_INSET,
  };
}
