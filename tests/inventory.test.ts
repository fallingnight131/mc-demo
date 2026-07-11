// 旧档迁移:引用式快捷栏 + stash → 统一实体槽(重复引用去重)
import { describe, expect, it } from 'vitest';
import { migrateLegacySlots, HOTBAR_SIZE, SLOTS_SIZE } from '../src/game/inventory';

describe('migrateLegacySlots', () => {
  it('快捷栏引用领取对应堆;同 id 重复引用只有第一个拿到(旧 bug 去重)', () => {
    const hotbar = [3, 3, 8, 0, 3, 0, 0, 0, 0, 0]; // 石头×3 次引用、圆石×1
    const stash: Array<[number, number, number]> = [
      [0, 3, 50], // 石头 ×50
      [1, 8, 2], // 圆石 ×2
      [2, 5, 7], // 原木 ×7(未被引用)
    ];
    const slots = migrateLegacySlots(hotbar, stash);
    expect(slots[0]).toEqual({ id: 3, count: 50 }); // 第一个引用拿到整堆
    expect(slots[1]).toBe(null); // 重复引用:去重为空
    expect(slots[2]).toEqual({ id: 8, count: 2 });
    expect(slots[4]).toBe(null); // 第三个石头引用同样为空
    expect(slots[HOTBAR_SIZE]).toEqual({ id: 5, count: 7 }); // 未引用的堆进背包区
    // 总量不丢不涨
    const total = slots.filter(Boolean).length;
    expect(total).toBe(3);
  });

  it('无引用的旧档:全部堆按序进背包区;空数据得默认空槽', () => {
    const stash: Array<[number, number, number]> = [
      [0, 2, 9],
      [5, 6, 1],
    ];
    const slots = migrateLegacySlots(undefined, stash);
    expect(slots.slice(0, HOTBAR_SIZE).every((s) => s === null)).toBe(true);
    expect(slots[HOTBAR_SIZE]).toEqual({ id: 2, count: 9 });
    expect(slots[HOTBAR_SIZE + 1]).toEqual({ id: 6, count: 1 });

    const empty = migrateLegacySlots(undefined, undefined);
    expect(empty).toHaveLength(SLOTS_SIZE);
    expect(empty.every((s) => s === null)).toBe(true);
  });

  it('引用了 stash 里不存在的物品 → 该格为空(没有就不显示)', () => {
    const slots = migrateLegacySlots([38, 102, 0, 0, 0, 0, 0, 0, 0, 0], [[0, 102, 1]]);
    expect(slots[0]).toBe(null); // 丛林草无库存
    expect(slots[1]).toEqual({ id: 102, count: 1 }); // 剑正常入栏
  });
});
