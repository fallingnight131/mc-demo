// 宝箱 / 背包存储:定长槽位,每槽一种物品堆叠 {id,count}(泰拉式双栏存取)
export type Slot = { id: number; count: number } | null;

export function makeSlots(n: number): Slot[] {
  return Array.from({ length: n }, () => null);
}

/** 往槽位组塞入 count 个 id:优先并入同 id 堆,再占空槽;返回未放下的余量(满则 >0) */
export function addToSlots(slots: Slot[], id: number, count: number): number {
  for (const s of slots) {
    if (s && s.id === id) {
      s.count += count;
      return 0;
    }
  }
  for (let i = 0; i < slots.length; i++) {
    if (!slots[i]) {
      slots[i] = { id, count };
      return 0;
    }
  }
  return count;
}

/** 还能再收纳一个该 id 吗(有同 id 堆可并入,或有空槽)—— 拾取满包守卫用 */
export function canAddToSlots(slots: Slot[], id: number): boolean {
  return slots.some((s) => (s ? s.id === id : true));
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

/** 把 from[i] 整堆移到 to(并入或占空槽);放不下则原地不动,返回是否成功移动 */
export function moveStack(from: Slot[], i: number, to: Slot[]): boolean {
  const s = from[i];
  if (!s) return false;
  const leftover = addToSlots(to, s.id, s.count);
  if (leftover === 0) {
    from[i] = null;
    return true;
  }
  return false;
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
          slots[i] = { id, count };
        }
      }
    }
  }
  return slots;
}
