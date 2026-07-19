// 系统层 · 合成(见 ARCHITECTURE.md §3.8d)
// 三件事:扫站台(scanStations)、算可合成(craftableTimes)、原子结算(performCraft)。
// 判定与事务是纯函数(vitest 裸测);Crafting 类只做接线:
// 列表渲染由 inventory.onBagRefresh 驱动,合成成功走事件总线 itemCrafted。
import { addToSlots, countInSlots, removeFromSlots, type Slot } from '../chest';
import { itemIcon, itemName, maxStackOf, type IconSource } from '../content/items';
import { allRecipes, recipeById, stationBlocks, type RecipeDef } from '../content/recipes';
import type { EventBus } from '../core/events';
import type { SaveManager } from '../core/save';
import type { CraftRowView, HUD } from '../hud';
import type { Sound } from '../sound';
import type { Inventory } from './inventory';

/** 站台范围:水平切比雪夫 ±3、垂直 ±2(泰拉式"站在旁边即可用") */
export const STATION_RANGE_H = 3;
export const STATION_RANGE_V = 2;

/** 扫描玩家周边的合成站(只认被配方引用过的方块 id) */
export function scanStations(
  getBlock: (x: number, y: number, z: number) => number,
  px: number,
  py: number,
  pz: number,
): Set<number> {
  const wanted = stationBlocks();
  const found = new Set<number>();
  const bx = Math.floor(px);
  const by = Math.floor(py);
  const bz = Math.floor(pz);
  for (let dy = -STATION_RANGE_V; dy <= STATION_RANGE_V; dy++) {
    for (let dz = -STATION_RANGE_H; dz <= STATION_RANGE_H; dz++) {
      for (let dx = -STATION_RANGE_H; dx <= STATION_RANGE_H; dx++) {
        const id = getBlock(bx + dx, by + dy, bz + dz);
        if (wanted.has(id)) found.add(id);
      }
    }
  }
  return found;
}

/** 配方所需站台是否全部在场 */
export function hasStations(stations: ReadonlySet<number>, r: RecipeDef): boolean {
  return r.stations.every((s) => stations.has(s));
}

/** 以现有材料最多能合成几次(0 = 材料不足) */
export function craftableTimes(slots: Slot[], r: RecipeDef): number {
  let times = Infinity;
  for (const ing of r.ingredients) {
    times = Math.min(times, Math.floor(countInSlots(slots, ing.id) / ing.count));
  }
  return Number.isFinite(times) ? times : 0;
}

export type CraftFail = 'materials' | 'cursor' | 'full';
export type CraftOutcome = { ok: true; cursor: Slot } | { ok: false; reason: CraftFail };

/**
 * 原子合成事务:校验 → 扣料 → 交付;任何一步失败整体回滚(槽位原样)。
 * toCursor=true(背包面板开着):产物落到手中堆 —— 空手拿起 / 同 id 并入,
 * 手持异物或超堆叠上限拒绝;toCursor=false(调试/e2e):产物直接入包,放不下拒绝。
 */
export function performCraft(
  slots: Slot[],
  cursor: Slot,
  toCursor: boolean,
  r: RecipeDef,
): CraftOutcome {
  if (craftableTimes(slots, r) < 1) return { ok: false, reason: 'materials' };
  const max = maxStackOf(r.result);
  if (toCursor && cursor && (cursor.id !== r.result || cursor.count + r.count > max)) {
    return { ok: false, reason: 'cursor' };
  }
  const backup = slots.map((s) => (s ? { ...s } : null));
  for (const ing of r.ingredients) removeFromSlots(slots, ing.id, ing.count);
  if (toCursor) {
    return { ok: true, cursor: { id: r.result, count: (cursor?.count ?? 0) + r.count } };
  }
  if (addToSlots(slots, r.result, r.count, max) > 0) {
    slots.splice(0, slots.length, ...backup); // 放不下:整体回滚,材料不消耗
    return { ok: false, reason: 'full' };
  }
  return { ok: true, cursor };
}

/** 合成列表条目:站台满足的配方 + 可合成次数(0 → 灰条不可点) */
export interface CraftEntry {
  recipe: RecipeDef;
  times: number;
}

export interface CraftingDeps {
  getBlock(x: number, y: number, z: number): number;
  playerPos(): { x: number; y: number; z: number };
  inventory: Inventory;
  hud: HUD;
  icons: IconSource;
  sound: Sound;
  events: EventBus;
  save: SaveManager;
}

export class Crafting {
  constructor(private readonly deps: CraftingDeps) {}

  /** 当前附近站台(方块 id;调试/e2e 契约) */
  stations(): Set<number> {
    const p = this.deps.playerPos();
    return scanStations(this.deps.getBlock, p.x, p.y, p.z);
  }

  /** 当前可见配方列表(站台不满足的整条隐藏,引导找站台) */
  list(stations = this.stations()): CraftEntry[] {
    const out: CraftEntry[] = [];
    for (const r of allRecipes()) {
      if (!hasStations(stations, r)) continue;
      out.push({ recipe: r, times: craftableTimes(this.deps.inventory.slots, r) });
    }
    return out;
  }

  /** 执行合成:成功则刷新 UI/存档并广播 itemCrafted;失败 toast 原因 */
  craft(id: string): boolean {
    const r = recipeById(id);
    if (!r) return false;
    const inv = this.deps.inventory;
    if (inv.isCreative()) return false; // 创造模式是全图鉴调色板,无合成
    if (!hasStations(this.stations(), r)) return false;
    const toCursor = inv.bagOpen;
    const res = performCraft(inv.slots, inv.cursor, toCursor, r);
    if (!res.ok) {
      const msg = {
        materials: '材料不足',
        cursor: '手中拿着别的物品,先放下再合成',
        full: '背包已满,无法合成',
      }[res.reason];
      this.deps.hud.toast(msg);
      return false;
    }
    if (toCursor) inv.cursor = res.cursor;
    this.deps.sound.pop();
    this.deps.events.emit('itemCrafted', { recipe: r.id, result: r.result, count: r.count });
    inv.refreshHotbar();
    if (inv.bagOpen) inv.refreshBag(); // 触发 onBagRefresh → 合成列表随之重算
    this.deps.save.markDirty();
    return true;
  }

  /** 背包面板合成分区渲染(inventory.onBagRefresh 驱动,见 main 接线) */
  renderList(): void {
    const stations = this.stations();
    const rows: CraftRowView[] = this.list(stations).map(({ recipe, times }) => ({
      id: recipe.id,
      name: itemName(recipe.result),
      icon: itemIcon(this.deps.icons, recipe.result),
      count: recipe.count,
      times,
      need: recipe.ingredients.map((i) => `${itemName(i.id)}×${i.count}`).join(' '),
    }));
    const stationNames = [...stations].map((s) => itemName(s)).join('/');
    this.deps.hud.buildCraft(
      rows,
      stations.size > 0 ? `附近站台:${stationNames}` : '徒手 · 靠近工作台等站台解锁更多',
      (id) => this.craft(id),
    );
  }
}
