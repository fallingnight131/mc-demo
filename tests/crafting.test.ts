// 合成系统:配方数据完整性 + 站台扫描 + 可合成判定 + 原子事务(ARCHITECTURE.md §3.8d)
import { describe, expect, it } from 'vitest';
import { Block, BLOCK_DEFS } from '../src/blocks';
import { countInSlots, makeSlots, type Slot } from '../src/chest';
import { itemDef, maxStackOf } from '../src/content/items';
import { allRecipes, recipeById, stationBlocks } from '../src/content/recipes';
import {
  craftableTimes,
  hasStations,
  performCraft,
  scanStations,
} from '../src/game/crafting';
import { Mat } from '../src/tools';

function slotsWith(...stacks: Array<[number, number]>): Slot[] {
  const slots = makeSlots(50);
  stacks.forEach(([id, count], i) => {
    slots[i] = { id, count };
  });
  return slots;
}

describe('配方注册表', () => {
  it('配方数据完整:产物/配料都是注册物品,数量为正,站台是有效方块,id 唯一', () => {
    const seen = new Set<string>();
    expect(allRecipes().length).toBeGreaterThanOrEqual(11);
    for (const r of allRecipes()) {
      expect(seen.has(r.id), `id 重复 ${r.id}`).toBe(false);
      seen.add(r.id);
      expect(itemDef(r.result), `${r.id} 产物`).toBeDefined();
      expect(r.count).toBeGreaterThan(0);
      expect(r.count).toBeLessThanOrEqual(maxStackOf(r.result));
      expect(r.ingredients.length).toBeGreaterThan(0);
      for (const ing of r.ingredients) {
        expect(itemDef(ing.id), `${r.id} 配料 #${ing.id}`).toBeDefined();
        expect(ing.count).toBeGreaterThan(0);
      }
      for (const s of r.stations) {
        expect(BLOCK_DEFS[s], `${r.id} 站台 #${s}`).toBeDefined();
        expect(stationBlocks().has(s)).toBe(true);
      }
    }
  });

  it('站台链可达:工作台徒手可得,熔炉@工作台,铁锭@熔炉,铁砧@工作台', () => {
    expect(recipeById('workbench')!.stations).toEqual([]);
    expect(recipeById('furnace')!.stations).toEqual([Block.Workbench]);
    expect(recipeById('iron-bar')!.stations).toEqual([Block.Furnace]);
    expect(recipeById('anvil')!.stations).toEqual([Block.Workbench]);
    expect(recipeById('iron-helmet')!.stations).toEqual([Block.Anvil]);
    expect(stationBlocks()).toEqual(new Set([Block.Workbench, Block.Furnace, Block.Anvil]));
  });
});

describe('站台扫描', () => {
  it('水平 ±3 / 垂直 ±2 内检出,半径外不检出,非站台方块不收', () => {
    const map = new Map<string, number>();
    const put = (x: number, y: number, z: number, id: number) => map.set(`${x},${y},${z}`, id);
    const getBlock = (x: number, y: number, z: number) => map.get(`${x},${y},${z}`) ?? Block.Air;
    put(3, 10, 0, Block.Workbench); // 水平边缘(+3)
    put(0, 12, 2, Block.Furnace); // 垂直边缘(+2)
    put(-4, 10, 0, Block.Anvil); // 水平半径外
    put(0, 10, 1, Block.Stone); // 非站台
    const st = scanStations(getBlock, 0.5, 10.2, 0.5);
    expect(st.has(Block.Workbench)).toBe(true);
    expect(st.has(Block.Furnace)).toBe(true);
    expect(st.has(Block.Anvil)).toBe(false);
    expect(st.has(Block.Stone)).toBe(false);
    expect(hasStations(st, recipeById('furnace')!)).toBe(true);
    expect(hasStations(st, recipeById('iron-helmet')!)).toBe(false);
    expect(hasStations(st, recipeById('plank')!)).toBe(true); // 徒手恒可
  });
});

describe('可合成判定', () => {
  it('对全部 50 格计数(物品栏 + 背包跨区、多堆合计),取配料最小倍数', () => {
    const r = recipeById('furnace')!; // 石 20 + 木板 4 + 火把 3
    const slots = makeSlots(50);
    slots[0] = { id: Block.Stone, count: 15 };
    slots[30] = { id: Block.Stone, count: 30 };
    slots[9] = { id: Block.Plank, count: 8 };
    slots[49] = { id: Block.Torch, count: 7 };
    expect(craftableTimes(slots, r)).toBe(2); // min(45/20, 8/4, 7/3) = 2
    slots[49] = { id: Block.Torch, count: 2 };
    expect(craftableTimes(slots, r)).toBe(0);
  });
});

describe('原子事务 performCraft', () => {
  it('手中堆交付:空手拿起 → 同 id 并入 → 手持异物拒绝且槽位原样', () => {
    const r = recipeById('torch')!; // 木板 1 → 火把 3
    const slots = slotsWith([Block.Plank, 5]);
    const out = performCraft(slots, null, true, r);
    expect(out.ok && out.cursor).toEqual({ id: Block.Torch, count: 3 });
    expect(countInSlots(slots, Block.Plank)).toBe(4);

    const out2 = performCraft(slots, { id: Block.Torch, count: 3 }, true, r);
    expect(out2.ok && out2.cursor?.count).toBe(6);
    expect(countInSlots(slots, Block.Plank)).toBe(3);

    const out3 = performCraft(slots, { id: Block.Stone, count: 1 }, true, r);
    expect(out3.ok).toBe(false);
    expect(!out3.ok && out3.reason).toBe('cursor');
    expect(countInSlots(slots, Block.Plank)).toBe(3);
  });

  it('材料不足拒绝,槽位原样', () => {
    const r = recipeById('workbench')!; // 木板 10
    const slots = slotsWith([Block.Plank, 9]);
    const out = performCraft(slots, null, true, r);
    expect(out.ok).toBe(false);
    expect(!out.ok && out.reason).toBe('materials');
    expect(countInSlots(slots, Block.Plank)).toBe(9);
  });

  it('上限 1 的装备:手中已持同类再合成被拒,材料只扣了成功那次', () => {
    const r = recipeById('iron-helmet')!; // 铁锭 8,maxStack 1
    const slots = slotsWith([Mat.IronBar, 20]);
    const first = performCraft(slots, null, true, r);
    expect(first.ok).toBe(true);
    const again = performCraft(slots, first.ok ? first.cursor : null, true, r);
    expect(again.ok).toBe(false);
    expect(countInSlots(slots, Mat.IronBar)).toBe(12);
  });

  it('入包交付(面板关着):正常入包;包满整体回滚,材料不消耗', () => {
    const r = recipeById('plank')!; // 原木 1 → 木板 4
    // 扣料腾出的格子可被产物复用:仅 1 个原木的格子扣空 → 木板占用 → 成功
    const slots: Slot[] = Array.from({ length: 50 }, () => ({ id: Block.Stone, count: 999 }));
    slots[0] = { id: Block.Log, count: 1 };
    const ok = performCraft(slots, null, false, r);
    expect(ok.ok).toBe(true);
    expect(countInSlots(slots, Block.Plank)).toBe(4);
    expect(countInSlots(slots, Block.Log)).toBe(0);

    // 原木 2 个:扣 1 后格子仍被占,木板无处可放 → 整体回滚
    const slots2: Slot[] = Array.from({ length: 50 }, () => ({ id: Block.Stone, count: 999 }));
    slots2[0] = { id: Block.Log, count: 2 };
    const fail = performCraft(slots2, null, false, r);
    expect(fail.ok).toBe(false);
    expect(!fail.ok && fail.reason).toBe('full');
    expect(countInSlots(slots2, Block.Log)).toBe(2);
    expect(countInSlots(slots2, Block.Plank)).toBe(0);
  });

  it('多配料跨堆扣料精确(熔炉:石 20 + 木板 4 + 火把 3)', () => {
    const r = recipeById('furnace')!;
    const slots = makeSlots(50);
    slots[0] = { id: Block.Stone, count: 12 };
    slots[20] = { id: Block.Stone, count: 12 };
    slots[1] = { id: Block.Plank, count: 4 };
    slots[2] = { id: Block.Torch, count: 5 };
    const out = performCraft(slots, null, false, r);
    expect(out.ok).toBe(true);
    expect(countInSlots(slots, Block.Stone)).toBe(4);
    expect(countInSlots(slots, Block.Plank)).toBe(0);
    expect(countInSlots(slots, Block.Torch)).toBe(2);
    expect(countInSlots(slots, Block.Furnace)).toBe(1);
  });
});
