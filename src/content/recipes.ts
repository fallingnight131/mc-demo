// 内容层 · 合成配方注册表(见 ARCHITECTURE.md §3.8d / §4.10)
// 配方是声明式数据:配料与产物是任意注册物品,站台是被 stations 引用的方块 id。
// 加一条配方 = registerRecipe 一条数据 —— 列表/判定/结算/UI 全自动。
// 纯数据模块:不触碰 DOM / Three.js,可在 vitest 裸测。
import { Block } from '../blocks';
import { Equip, Mat } from '../tools';

export interface RecipeIngredient {
  id: number;
  count: number;
}

export interface RecipeDef {
  /** 稳定标识('iron-bar'):e2e / itemCrafted 事件 / 未来成就用 */
  id: string;
  /** 产物物品 id */
  result: number;
  /** 产物数量 */
  count: number;
  ingredients: ReadonlyArray<RecipeIngredient>;
  /** 所需合成站方块 id,须全部在玩家附近;[] = 徒手配方 */
  stations: ReadonlyArray<number>;
}

const recipes: RecipeDef[] = [];
const recipeIndex = new Map<string, RecipeDef>();

export function registerRecipe(def: RecipeDef): void {
  if (recipeIndex.has(def.id)) throw new Error(`配方 id 重复:${def.id}`);
  recipeIndex.set(def.id, def);
  recipes.push(def);
}

/** 全部配方(注册顺序 = 列表展示顺序:徒手→站台,循序渐进) */
export function allRecipes(): ReadonlyArray<RecipeDef> {
  return recipes;
}

export function recipeById(id: string): RecipeDef | undefined {
  return recipeIndex.get(id);
}

/** 被任意配方引用为站台的方块 id 集合(站台扫描只认这些) */
let stationSet: Set<number> | null = null;
export function stationBlocks(): ReadonlySet<number> {
  if (!stationSet) {
    stationSet = new Set<number>();
    for (const r of recipes) for (const s of r.stations) stationSet.add(s);
  }
  return stationSet;
}

// ---------------------------------------------------------------------------
// 参考配方(里程碑 58):泰拉式进阶闭环
// 原木→木板→工作台→熔炉→铁锭→铁砧→铁甲;站台链 = 站台自身也走配方。
// ---------------------------------------------------------------------------

const r = (
  id: string,
  result: number,
  count: number,
  ingredients: Array<[number, number]>,
  stations: number[] = [],
) =>
  registerRecipe({
    id,
    result,
    count,
    ingredients: ingredients.map(([iid, c]) => ({ id: iid, count: c })),
    stations,
  });

// 徒手
r('plank', Block.Plank, 4, [[Block.Log, 1]]);
r('torch', Block.Torch, 3, [[Block.Plank, 1]]);
r('workbench', Block.Workbench, 1, [[Block.Plank, 10]]);

// 工作台
r('stone-brick', Block.StoneBrick, 1, [[Block.Stone, 1]], [Block.Workbench]);
r('furnace', Block.Furnace, 1, [[Block.Stone, 20], [Block.Plank, 4], [Block.Torch, 3]], [Block.Workbench]);
r('anvil', Block.Anvil, 1, [[Mat.IronBar, 5]], [Block.Workbench]);

// 熔炉
r('iron-bar', Mat.IronBar, 1, [[Block.IronOre, 3]], [Block.Furnace]);
r('glass', Block.Glass, 1, [[Block.Sand, 1]], [Block.Furnace]);

// 铁砧
r('iron-helmet', Equip.IronHelmet, 1, [[Mat.IronBar, 8]], [Block.Anvil]);
r('iron-chest', Equip.IronChest, 1, [[Mat.IronBar, 12]], [Block.Anvil]);
r('iron-legs', Equip.IronLegs, 1, [[Mat.IronBar, 10]], [Block.Anvil]);
