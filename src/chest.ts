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
