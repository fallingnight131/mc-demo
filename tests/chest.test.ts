import { describe, expect, it } from 'vitest';
import {
  addToSlots,
  canAddToSlots,
  countInSlots,
  deserializeSlots,
  dropToSlot,
  liftFromSlot,
  makeSlots,
  moveStack,
  removeFromSlots,
  serializeSlots,
} from '../src/chest';

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

  it('countInSlots 统计总数;removeFromSlots 按量移除并清空耗尽槽', () => {
    const s = makeSlots(3);
    addToSlots(s, 5, 3);
    addToSlots(s, 6, 1);
    expect(countInSlots(s, 5)).toBe(3);
    expect(removeFromSlots(s, 5, 1)).toBe(1); // 消耗 1(放置)
    expect(countInSlots(s, 5)).toBe(2);
    expect(removeFromSlots(s, 5, 5)).toBe(2); // 只够 2,槽清空
    expect(s[0]).toBe(null);
    expect(countInSlots(s, 5)).toBe(0);
    expect(removeFromSlots(s, 9, 1)).toBe(0); // 没有的东西移除 0
    expect(countInSlots(s, 6)).toBe(1); // 其他物品不受波及
  });

  it('canAddToSlots:满包且无同 id 堆时拒收(拾取守卫)', () => {
    const s = makeSlots(2);
    addToSlots(s, 5, 1);
    expect(canAddToSlots(s, 9)).toBe(true); // 还有空槽
    addToSlots(s, 6, 1);
    expect(canAddToSlots(s, 9)).toBe(false); // 满且无同 id
    expect(canAddToSlots(s, 5)).toBe(true); // 可并入同 id 堆
    expect(canAddToSlots(s, 5, 1)).toBe(false); // 同 id 堆已到上限也拒收
  });

  it('堆叠上限:补满旧堆→开新堆→槽尽返余量;超大旧档读入被夹到上限', () => {
    const s = makeSlots(2);
    expect(addToSlots(s, 5, 1200, 999)).toBe(0); // 999 + 201 两堆
    expect(s[0]).toEqual({ id: 5, count: 999 });
    expect(s[1]).toEqual({ id: 5, count: 201 });
    expect(addToSlots(s, 5, 1000, 999)).toBe(202); // 只补得下 798
    expect(s[1]).toEqual({ id: 5, count: 999 });
    expect(countInSlots(s, 5)).toBe(1998);
    // 旧档超大堆:反序列化夹到 999
    const back = deserializeSlots(1, [[0, 7, 5000]]);
    expect(back[0]).toEqual({ id: 7, count: 999 });
  });

  it('moveStack 部分转移:目标只装得下一部分时,余量留在原槽', () => {
    const a = makeSlots(1);
    const b = makeSlots(1);
    addToSlots(a, 5, 500, 999);
    addToSlots(b, 5, 700, 999);
    expect(moveStack(a, 0, b, 999)).toBe(true); // 只能并入 299
    expect(b[0]).toEqual({ id: 5, count: 999 });
    expect(a[0]).toEqual({ id: 5, count: 201 }); // 余量留在原槽
    expect(moveStack(a, 0, b, 999)).toBe(false); // 目标满:原地不动
    expect(a[0]).toEqual({ id: 5, count: 201 });
  });

  it('拖拽:拿起整堆/半堆,放下时空槽放入、同类并入到上限、异类交换', () => {
    const s = makeSlots(3);
    addToSlots(s, 5, 10);
    addToSlots(s, 6, 4);
    // 右键拿一半
    let cursor = liftFromSlot(s, 0, 5);
    expect(cursor).toEqual({ id: 5, count: 5 });
    expect(s[0]).toEqual({ id: 5, count: 5 }); // 拆成两份:同类分占两处是合法的
    // 放到空槽
    cursor = dropToSlot(s, 2, cursor);
    expect(cursor).toBe(null);
    expect(s[2]).toEqual({ id: 5, count: 5 });
    // 拿起整堆并入同类(上限内)
    cursor = liftFromSlot(s, 2);
    cursor = dropToSlot(s, 0, cursor);
    expect(cursor).toBe(null);
    expect(s[0]).toEqual({ id: 5, count: 10 });
    // 异类交换:手上 5,槽里 6 → 换
    cursor = liftFromSlot(s, 0);
    cursor = dropToSlot(s, 1, cursor);
    expect(cursor).toEqual({ id: 6, count: 4 });
    expect(s[1]).toEqual({ id: 5, count: 10 });
    // 同类并入触上限:余量留手
    const t = makeSlots(1);
    addToSlots(t, 6, 998, 999);
    cursor = dropToSlot(t, 0, cursor, 999);
    expect(t[0]).toEqual({ id: 6, count: 999 });
    expect(cursor).toEqual({ id: 6, count: 3 });
    // 空手拿空槽:无事发生
    expect(liftFromSlot(makeSlots(1), 0)).toBe(null);
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
