import { describe, expect, it } from 'vitest';
import { addToSlots, deserializeSlots, makeSlots, moveStack, serializeSlots } from '../src/chest';

describe('宝箱/背包存储', () => {
  it('addToSlots 优先并入同 id 堆,再占空槽,满则返回余量', () => {
    const s = makeSlots(3);
    expect(addToSlots(s, 5, 1)).toBe(0);
    expect(addToSlots(s, 5, 2)).toBe(0); // 并入同堆 → 数量 3
    expect(s[0]).toEqual({ id: 5, count: 3 });
    expect(s[1]).toBe(null);
    expect(addToSlots(s, 6, 1)).toBe(0);
    expect(addToSlots(s, 7, 1)).toBe(0);
    expect(s.filter(Boolean).length).toBe(3);
    expect(addToSlots(s, 8, 1)).toBe(1); // 满,返回余量
  });

  it('moveStack 整堆在两组间移动(并入或占空槽),空槽移动失败', () => {
    const a = makeSlots(2);
    const b = makeSlots(2);
    addToSlots(a, 5, 3);
    expect(moveStack(a, 0, b)).toBe(true);
    expect(a[0]).toBe(null);
    expect(b[0]).toEqual({ id: 5, count: 3 });
    expect(moveStack(a, 0, b)).toBe(false); // 空槽
  });

  it('目标满且无同 id 时 moveStack 原地不动', () => {
    const a = makeSlots(1);
    const b = makeSlots(1);
    addToSlots(a, 5, 1);
    addToSlots(b, 6, 1); // b 满且无同 id
    expect(moveStack(a, 0, b)).toBe(false);
    expect(a[0]).toEqual({ id: 5, count: 1 }); // 原地不动
  });

  it('序列化往返保真(稀疏),非法数据被过滤', () => {
    const s = makeSlots(5);
    addToSlots(s, 5, 2);
    s[3] = { id: 7, count: 9 };
    const back = deserializeSlots(5, serializeSlots(s));
    expect(back).toEqual(s);
    expect(deserializeSlots(3, [[9, 5, 1], [0, 5, -1], 'x'])).toEqual(makeSlots(3));
  });
});
