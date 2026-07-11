// 宝箱 / 背包存储:定长槽位堆叠 {id,count}(泰拉式双栏存取)。
// 泰拉瑞亚 PC 规格:每堆上限 STACK_MAX,同 id 可占多堆;槽位数即"种类×堆"上限。
export type Slot = { id: number; count: number } | null;

/** 单堆容量上限(泰拉瑞亚 1.4 起大多数物品 999) */
export const STACK_MAX = 999;

export function makeSlots(n: number): Slot[] {
  return Array.from({ length: n }, () => null);
}

/** 往槽位组塞入 count 个 id:先补满既有同 id 堆(至 max),再开新堆;
 *  返回未放下的余量(槽位不够则 >0) */
export function addToSlots(slots: Slot[], id: number, count: number, max = STACK_MAX): number {
  let left = count;
  for (const s of slots) {
    if (left <= 0) break;
    if (s && s.id === id && s.count < max) {
      const take = Math.min(max - s.count, left);
      s.count += take;
      left -= take;
    }
  }
  for (let i = 0; i < slots.length && left > 0; i++) {
    if (!slots[i]) {
      const take = Math.min(max, left);
      slots[i] = { id, count: take };
      left -= take;
    }
  }
  return left;
}

/** 还能再收纳一个该 id 吗(有未满的同 id 堆,或有空槽)—— 拾取满包守卫用 */
export function canAddToSlots(slots: Slot[], id: number, max = STACK_MAX): boolean {
  return slots.some((s) => (s ? s.id === id && s.count < max : true));
}

/** 统计槽位组中某 id 的总数(所有权判定:放置/中键选取都查这里) */
export function countInSlots(slots: Slot[], id: number): number {
  let n = 0;
  for (const s of slots) if (s && s.id === id) n += s.count;
  return n;
}

/** 移除至多 count 个 id(耗尽的槽清空);返回实际移除数(不足则少于 count) */
export function removeFromSlots(slots: Slot[], id: number, count: number): number {
  let left = count;
  for (let i = 0; i < slots.length && left > 0; i++) {
    const s = slots[i];
    if (!s || s.id !== id) continue;
    const take = Math.min(s.count, left);
    s.count -= take;
    left -= take;
    if (s.count <= 0) slots[i] = null;
  }
  return count - left;
}

/** 从槽位拿起(拖拽):amount 省略拿整堆,右键传半堆;拿空的槽清 null */
export function liftFromSlot(slots: Slot[], i: number, amount?: number): Slot {
  const s = slots[i];
  if (!s) return null;
  const take = Math.min(s.count, Math.max(1, amount ?? s.count));
  if (take >= s.count) {
    slots[i] = null;
    return s;
  }
  s.count -= take;
  return { id: s.id, count: take };
}

/** 手中堆放到槽位(拖拽):空槽放入 / 同 id 并入(到上限,余量留手)/ 异 id 交换;
 *  返回新的手中堆(null = 手空了) */
export function dropToSlot(slots: Slot[], i: number, cursor: Slot, max = STACK_MAX): Slot {
  if (!cursor) return null;
  const t = slots[i];
  if (!t) {
    slots[i] = cursor;
    return null;
  }
  if (t.id === cursor.id) {
    const take = Math.min(max - t.count, cursor.count);
    t.count += take;
    const left = cursor.count - take;
    return left > 0 ? { id: cursor.id, count: left } : null;
  }
  slots[i] = cursor; // 异类:交换
  return t;
}

/** 把 from[i] 整堆移到 to(并入未满堆或开新堆,受堆叠上限约束);
 *  放不完时移走能放下的、余量留在原槽;一点都放不下返回 false */
export function moveStack(from: Slot[], i: number, to: Slot[], max = STACK_MAX): boolean {
  const s = from[i];
  if (!s) return false;
  const leftover = addToSlots(to, s.id, s.count, max);
  if (leftover === s.count) return false; // 目标满且无可并入堆:原地不动
  from[i] = leftover > 0 ? { id: s.id, count: leftover } : null;
  return true;
}

/** 稀疏序列化(存档):[[槽位, id, 数量], ...] */
export function serializeSlots(slots: Slot[]): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  slots.forEach((s, i) => {
    if (s) out.push([i, s.id, s.count]);
  });
  return out;
}

export function deserializeSlots(n: number, data: unknown): Slot[] {
  const slots = makeSlots(n);
  if (Array.isArray(data)) {
    for (const e of data) {
      if (Array.isArray(e) && e.length === 3) {
        const [i, id, count] = e as [number, number, number];
        if (
          typeof i === 'number' && i >= 0 && i < n &&
          typeof id === 'number' && id > 0 &&
          typeof count === 'number' && count > 0
        ) {
          // 上限时代之前的旧档可能有超大堆:夹到堆叠上限
          slots[i] = { id, count: Math.min(count, STACK_MAX) };
        }
      }
    }
  }
  return slots;
}
