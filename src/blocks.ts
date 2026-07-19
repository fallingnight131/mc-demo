// 方块与纹理图集定义(纯数据,不依赖 DOM)

export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 8;
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
  TntSide: 15,
  TntTop: 16,
  TntBottom: 17,
  Sandstone: 18,
  Brick: 19,
  StoneBrick: 20,
  CoalOre: 21,
  IronOre: 22,
  GoldOre: 23,
  DiamondOre: 24,
  Obsidian: 25,
  PumpkinSide: 26,
  PumpkinTop: 27,
  PumpkinFace: 28,
  IronBlock: 29,
  GoldBlock: 30,
  DiamondBlock: 31,
  Torch: 32,
  Glowstone: 33,
  Lava: 34,
  Ash: 35,
  Hellstone: 36,
  JungleGrass: 37,
  CorruptGrass: 38,
  EbonStone: 39,
  JungleLeaves: 40,
  CorruptLeaves: 41,
  ChestSide: 42,
  ChestFront: 43,
  ChestTop: 44,
  DungeonBrick: 45,
  Cloud: 46,
  TallGrass: 47, // 青草丛(十字面片)
  Flower: 48, // 野花(红黄花)
  JungleFern: 49, // 丛林蕨
  CorruptThorn: 50, // 腐化荆棘
  CrimsonGrass: 51, // 血腥草地
  Crimstone: 52, // 猩红石
  CrimsonLeaves: 53, // 血腥树叶
  CrimsonVine: 54, // 血腥藤(十字面片)
  // 合成站(里程碑 58)
  WorkbenchTop: 55, // 工作台桌面
  WorkbenchSide: 56, // 工作台侧面(桌腿)
  FurnaceSide: 57, // 熔炉侧面
  FurnaceFront: 58, // 熔炉炉口(火光)
  FurnaceTop: 59, // 熔炉顶面
  AnvilTop: 60, // 铁砧顶面(砧面)
  AnvilSide: 61, // 铁砧侧面(砧腰)
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
  Water: 10, // 水源(等级 4)
  Snow: 11,
  Glass: 12,
  // 流动水,等级 4..1(等级越低水面越浅)
  Flow4: 13,
  Flow3: 14,
  Flow2: 15,
  Flow1: 16,
  TNT: 17,
  Sandstone: 18,
  Brick: 19,
  StoneBrick: 20,
  CoalOre: 21,
  IronOre: 22,
  GoldOre: 23,
  DiamondOre: 24,
  Obsidian: 25,
  Pumpkin: 26, // 脸朝 +z(南)
  IronBlock: 27,
  GoldBlock: 28,
  DiamondBlock: 29,
  // 南瓜的其余三个水平朝向(放置时按视角选择,共用基础南瓜的贴图)
  PumpkinE: 30, // 脸朝 +x
  PumpkinN: 31, // 脸朝 -z
  PumpkinW: 32, // 脸朝 -x
  Torch: 33, // 火把:十字面片,光源 14
  Glowstone: 34, // 萤石:光源 15
  Lava: 35, // 岩浆:地狱海,接触伤害,视觉自亮(不传播光)
  Ash: 36, // 灰烬:地狱地表
  Hellstone: 37, // 地狱石:发光矿,视觉自亮
  JungleGrass: 38, // 丛林草地
  CorruptGrass: 39, // 腐化草地
  EbonStone: 40, // 腐化石(黑檀石)
  JungleLeaves: 41, // 丛林树叶
  CorruptLeaves: 42, // 腐化树叶
  Chest: 43, // 宝箱:点按开箱掉战利品(地标专属,不可放置不可挖)
  DungeonBrick: 44, // 地牢砖:泰拉蓝砖,坚硬
  Cloud: 45, // 云块:天空岛材质
  // 植被(十字面片,非碰撞,依环境生长):森林青草/野花、丛林蕨、腐化荆棘
  TallGrass: 46,
  Flower: 47,
  JungleFern: 48,
  CorruptThorn: 49,
  // 血腥之地(泰拉血腥群系):血腥草/猩红石/血腥树叶/血腥藤
  CrimsonGrass: 50,
  Crimstone: 51,
  CrimsonLeaves: 52,
  CrimsonVine: 53,
  // 合成站(ARCHITECTURE.md §3.8d:被配方 stations 引用即成为站台)
  Workbench: 54, // 工作台:徒手 10 木板制作,解锁工作台配方
  Furnace: 55, // 熔炉:炼矿/烧玻璃
  Anvil: 56, // 铁砧:锻造铁器
} as const;

export interface BlockDef {
  name: string;
  /** 六面纹理 [+x, -x, +y, -y, +z, -z],空气为 null */
  tiles: [number, number, number, number, number, number] | null;
  solid: boolean; // 是否参与碰撞
  opaque: boolean; // 是否完全遮挡相邻面
  hardness: number; // 徒手挖掘耗时(秒),Infinity 表示不可破坏
  /** 发光等级(0..15),火把 14/萤石 15 */
  light?: number;
  /** 渲染形状:cross = 十字交叉面片(火把等) */
  shape?: 'cross';
  /** 只能放在实体方块顶面(火把) */
  needsGround?: boolean;
  /** 重力方块:下方失去支撑时坠落(沙子) */
  gravity?: boolean;
  /** 视觉自发光 0..1(不参与光照传播,岩浆/地狱石用) */
  glow?: number;
  /** 随风摇曳(树叶顶面、草木植被的顶端顶点) */
  sway?: boolean;
}

const T = Tile;
const WATER_TILES: [number, number, number, number, number, number] = [
  T.Water, T.Water, T.Water, T.Water, T.Water, T.Water,
];
export const BLOCK_DEFS: BlockDef[] = [
  { name: '空气', tiles: null, solid: false, opaque: false, hardness: 0 },
  { name: '草方块', tiles: [T.GrassSide, T.GrassSide, T.GrassTop, T.Dirt, T.GrassSide, T.GrassSide], solid: true, opaque: true, hardness: 0.45 },
  { name: '泥土', tiles: [T.Dirt, T.Dirt, T.Dirt, T.Dirt, T.Dirt, T.Dirt], solid: true, opaque: true, hardness: 0.4 },
  { name: '石头', tiles: [T.Stone, T.Stone, T.Stone, T.Stone, T.Stone, T.Stone], solid: true, opaque: true, hardness: 1.2 },
  { name: '沙子', tiles: [T.Sand, T.Sand, T.Sand, T.Sand, T.Sand, T.Sand], solid: true, opaque: true, hardness: 0.35, gravity: true },
  { name: '原木', tiles: [T.LogSide, T.LogSide, T.LogTop, T.LogTop, T.LogSide, T.LogSide], solid: true, opaque: true, hardness: 0.9 },
  { name: '树叶', tiles: [T.Leaves, T.Leaves, T.Leaves, T.Leaves, T.Leaves, T.Leaves], solid: true, opaque: true, hardness: 0.2, sway: true },
  { name: '木板', tiles: [T.Plank, T.Plank, T.Plank, T.Plank, T.Plank, T.Plank], solid: true, opaque: true, hardness: 0.8 },
  { name: '圆石', tiles: [T.Cobble, T.Cobble, T.Cobble, T.Cobble, T.Cobble, T.Cobble], solid: true, opaque: true, hardness: 1.3 },
  { name: '基岩', tiles: [T.Bedrock, T.Bedrock, T.Bedrock, T.Bedrock, T.Bedrock, T.Bedrock], solid: true, opaque: true, hardness: Infinity },
  { name: '水', tiles: WATER_TILES, solid: false, opaque: false, hardness: Infinity },
  { name: '雪块', tiles: [T.SnowSide, T.SnowSide, T.Snow, T.Dirt, T.SnowSide, T.SnowSide], solid: true, opaque: true, hardness: 0.3 },
  { name: '玻璃', tiles: [T.Glass, T.Glass, T.Glass, T.Glass, T.Glass, T.Glass], solid: true, opaque: false, hardness: 0.25 },
  { name: '流水', tiles: WATER_TILES, solid: false, opaque: false, hardness: Infinity },
  { name: '流水', tiles: WATER_TILES, solid: false, opaque: false, hardness: Infinity },
  { name: '流水', tiles: WATER_TILES, solid: false, opaque: false, hardness: Infinity },
  { name: '流水', tiles: WATER_TILES, solid: false, opaque: false, hardness: Infinity },
  { name: 'TNT', tiles: [T.TntSide, T.TntSide, T.TntTop, T.TntBottom, T.TntSide, T.TntSide], solid: true, opaque: true, hardness: 0.25 },
  { name: '砂岩', tiles: [T.Sandstone, T.Sandstone, T.Sand, T.Sandstone, T.Sandstone, T.Sandstone], solid: true, opaque: true, hardness: 0.9 },
  { name: '砖块', tiles: [T.Brick, T.Brick, T.Brick, T.Brick, T.Brick, T.Brick], solid: true, opaque: true, hardness: 1.4 },
  { name: '石砖', tiles: [T.StoneBrick, T.StoneBrick, T.StoneBrick, T.StoneBrick, T.StoneBrick, T.StoneBrick], solid: true, opaque: true, hardness: 1.3 },
  { name: '煤矿石', tiles: [T.CoalOre, T.CoalOre, T.CoalOre, T.CoalOre, T.CoalOre, T.CoalOre], solid: true, opaque: true, hardness: 1.6 },
  { name: '铁矿石', tiles: [T.IronOre, T.IronOre, T.IronOre, T.IronOre, T.IronOre, T.IronOre], solid: true, opaque: true, hardness: 1.8 },
  { name: '金矿石', tiles: [T.GoldOre, T.GoldOre, T.GoldOre, T.GoldOre, T.GoldOre, T.GoldOre], solid: true, opaque: true, hardness: 1.8 },
  { name: '钻石矿石', tiles: [T.DiamondOre, T.DiamondOre, T.DiamondOre, T.DiamondOre, T.DiamondOre, T.DiamondOre], solid: true, opaque: true, hardness: 2.2 },
  { name: '黑曜石', tiles: [T.Obsidian, T.Obsidian, T.Obsidian, T.Obsidian, T.Obsidian, T.Obsidian], solid: true, opaque: true, hardness: 4 },
  { name: '南瓜', tiles: [T.PumpkinSide, T.PumpkinSide, T.PumpkinTop, T.PumpkinTop, T.PumpkinFace, T.PumpkinSide], solid: true, opaque: true, hardness: 0.5 },
  { name: '铁块', tiles: [T.IronBlock, T.IronBlock, T.IronBlock, T.IronBlock, T.IronBlock, T.IronBlock], solid: true, opaque: true, hardness: 2.5 },
  { name: '金块', tiles: [T.GoldBlock, T.GoldBlock, T.GoldBlock, T.GoldBlock, T.GoldBlock, T.GoldBlock], solid: true, opaque: true, hardness: 2 },
  { name: '钻石块', tiles: [T.DiamondBlock, T.DiamondBlock, T.DiamondBlock, T.DiamondBlock, T.DiamondBlock, T.DiamondBlock], solid: true, opaque: true, hardness: 3 },
  { name: '南瓜', tiles: [T.PumpkinFace, T.PumpkinSide, T.PumpkinTop, T.PumpkinTop, T.PumpkinSide, T.PumpkinSide], solid: true, opaque: true, hardness: 0.5 },
  { name: '南瓜', tiles: [T.PumpkinSide, T.PumpkinSide, T.PumpkinTop, T.PumpkinTop, T.PumpkinSide, T.PumpkinFace], solid: true, opaque: true, hardness: 0.5 },
  { name: '南瓜', tiles: [T.PumpkinSide, T.PumpkinFace, T.PumpkinTop, T.PumpkinTop, T.PumpkinSide, T.PumpkinSide], solid: true, opaque: true, hardness: 0.5 },
  { name: '火把', tiles: [T.Torch, T.Torch, T.Torch, T.Torch, T.Torch, T.Torch], solid: false, opaque: false, hardness: 0.1, light: 14, shape: 'cross', needsGround: true },
  { name: '萤石', tiles: [T.Glowstone, T.Glowstone, T.Glowstone, T.Glowstone, T.Glowstone, T.Glowstone], solid: true, opaque: true, hardness: 0.4, light: 15 },
  { name: '岩浆', tiles: [T.Lava, T.Lava, T.Lava, T.Lava, T.Lava, T.Lava], solid: false, opaque: false, hardness: Infinity, glow: 0.95 },
  { name: '灰烬', tiles: [T.Ash, T.Ash, T.Ash, T.Ash, T.Ash, T.Ash], solid: true, opaque: true, hardness: 0.4 },
  { name: '地狱石', tiles: [T.Hellstone, T.Hellstone, T.Hellstone, T.Hellstone, T.Hellstone, T.Hellstone], solid: true, opaque: true, hardness: 2.4, glow: 0.5 },
  { name: '丛林草', tiles: [T.JungleGrass, T.JungleGrass, T.JungleGrass, T.Dirt, T.JungleGrass, T.JungleGrass], solid: true, opaque: true, hardness: 0.45 },
  { name: '腐化草', tiles: [T.CorruptGrass, T.CorruptGrass, T.CorruptGrass, T.CorruptGrass, T.CorruptGrass, T.CorruptGrass], solid: true, opaque: true, hardness: 0.45 },
  { name: '黑檀石', tiles: [T.EbonStone, T.EbonStone, T.EbonStone, T.EbonStone, T.EbonStone, T.EbonStone], solid: true, opaque: true, hardness: 1.4 },
  { name: '丛林树叶', tiles: [T.JungleLeaves, T.JungleLeaves, T.JungleLeaves, T.JungleLeaves, T.JungleLeaves, T.JungleLeaves], solid: true, opaque: true, hardness: 0.2, sway: true },
  { name: '腐化树叶', tiles: [T.CorruptLeaves, T.CorruptLeaves, T.CorruptLeaves, T.CorruptLeaves, T.CorruptLeaves, T.CorruptLeaves], solid: true, opaque: true, hardness: 0.2, sway: true },
  { name: '宝箱', tiles: [T.ChestSide, T.ChestSide, T.ChestTop, T.ChestTop, T.ChestFront, T.ChestSide], solid: true, opaque: true, hardness: Infinity },
  { name: '地牢砖', tiles: [T.DungeonBrick, T.DungeonBrick, T.DungeonBrick, T.DungeonBrick, T.DungeonBrick, T.DungeonBrick], solid: true, opaque: true, hardness: 5 },
  { name: '云块', tiles: [T.Cloud, T.Cloud, T.Cloud, T.Cloud, T.Cloud, T.Cloud], solid: true, opaque: true, hardness: 0.2 },
  // 植被:十字面片,非碰撞可穿行、可点按采除,顶端随风摇曳,只能立在实体顶面
  { name: '青草', tiles: [T.TallGrass, T.TallGrass, T.TallGrass, T.TallGrass, T.TallGrass, T.TallGrass], solid: false, opaque: false, hardness: 0.1, shape: 'cross', needsGround: true, sway: true },
  { name: '野花', tiles: [T.Flower, T.Flower, T.Flower, T.Flower, T.Flower, T.Flower], solid: false, opaque: false, hardness: 0.1, shape: 'cross', needsGround: true, sway: true },
  { name: '丛林蕨', tiles: [T.JungleFern, T.JungleFern, T.JungleFern, T.JungleFern, T.JungleFern, T.JungleFern], solid: false, opaque: false, hardness: 0.1, shape: 'cross', needsGround: true, sway: true },
  { name: '腐化荆棘', tiles: [T.CorruptThorn, T.CorruptThorn, T.CorruptThorn, T.CorruptThorn, T.CorruptThorn, T.CorruptThorn], solid: false, opaque: false, hardness: 0.1, shape: 'cross', needsGround: true, sway: true },
  // 血腥之地方块(镜像腐化之地,红肉调):血腥草/猩红石/血腥树叶/血腥藤
  { name: '血腥草', tiles: [T.CrimsonGrass, T.CrimsonGrass, T.CrimsonGrass, T.CrimsonGrass, T.CrimsonGrass, T.CrimsonGrass], solid: true, opaque: true, hardness: 0.45 },
  { name: '猩红石', tiles: [T.Crimstone, T.Crimstone, T.Crimstone, T.Crimstone, T.Crimstone, T.Crimstone], solid: true, opaque: true, hardness: 1.4 },
  { name: '血腥树叶', tiles: [T.CrimsonLeaves, T.CrimsonLeaves, T.CrimsonLeaves, T.CrimsonLeaves, T.CrimsonLeaves, T.CrimsonLeaves], solid: true, opaque: true, hardness: 0.2, sway: true },
  { name: '血腥藤', tiles: [T.CrimsonVine, T.CrimsonVine, T.CrimsonVine, T.CrimsonVine, T.CrimsonVine, T.CrimsonVine], solid: false, opaque: false, hardness: 0.1, shape: 'cross', needsGround: true, sway: true },
  // 合成站(家具:须放在实体方块顶面)
  { name: '工作台', tiles: [T.WorkbenchSide, T.WorkbenchSide, T.WorkbenchTop, T.WorkbenchSide, T.WorkbenchSide, T.WorkbenchSide], solid: true, opaque: true, hardness: 0.8, needsGround: true },
  { name: '熔炉', tiles: [T.FurnaceSide, T.FurnaceSide, T.FurnaceTop, T.FurnaceTop, T.FurnaceFront, T.FurnaceSide], solid: true, opaque: true, hardness: 1.5, needsGround: true, glow: 0.25 },
  { name: '铁砧', tiles: [T.AnvilSide, T.AnvilSide, T.AnvilTop, T.AnvilTop, T.AnvilSide, T.AnvilSide], solid: true, opaque: true, hardness: 2.2, needsGround: true },
];

/** 方块发光等级(0..15) */
export function lightLevel(id: number): number {
  return BLOCK_DEFS[id]?.light ?? 0;
}

/** 是否为水(水源或任意等级流水) */
export function isWater(id: number): boolean {
  return id === Block.Water || (id >= Block.Flow4 && id <= Block.Flow1);
}

/** 水位等级:水源/Flow4 为 4,Flow1 为 1,非水为 0 */
export function waterLevel(id: number): number {
  if (id === Block.Water) return 4;
  if (id >= Block.Flow4 && id <= Block.Flow1) return 4 - (id - Block.Flow4);
  return 0;
}

/** 等级对应的流水方块 id(1..4) */
export function flowId(level: number): number {
  return Block.Flow4 + (4 - level);
}

/** 可放置的方块(前 10 个为默认快捷栏,其余通过背包 E 选用) */
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
  Block.TNT,
  Block.Sandstone,
  Block.Brick,
  Block.StoneBrick,
  Block.Snow,
  Block.Obsidian,
  Block.Pumpkin,
  Block.CoalOre,
  Block.IronOre,
  Block.GoldOre,
  Block.DiamondOre,
  Block.IronBlock,
  Block.GoldBlock,
  Block.DiamondBlock,
  Block.Torch,
  Block.Glowstone,
  Block.DungeonBrick,
  Block.Cloud,
  Block.TallGrass,
  Block.Flower,
  Block.JungleFern,
  Block.CorruptThorn,
  Block.CrimsonVine,
  Block.Workbench,
  Block.Furnace,
  Block.Anvil,
];

/** 按放置者视角选南瓜朝向:脸转向玩家 */
export function pumpkinVariant(yaw: number): number {
  // 玩家前方 = (-sin, -cos),脸应朝玩家 = (sin, cos)
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  if (Math.abs(fx) > Math.abs(fz)) return fx > 0 ? Block.PumpkinE : Block.PumpkinW;
  return fz > 0 ? Block.Pumpkin : Block.PumpkinN;
}

/** 朝向变体归一化(掉落/选取/计数按基础方块算) */
export function baseBlock(id: number): number {
  if (id === Block.PumpkinE || id === Block.PumpkinN || id === Block.PumpkinW) {
    return Block.Pumpkin;
  }
  return id;
}

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
