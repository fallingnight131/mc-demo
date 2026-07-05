// 体素块光照:光源(火把/萤石)BFS 传播,0..15 逐格衰减,不透明方块遮挡。
// 稀疏存储(只存 >0 的格子);重算策略为全量重播所有光源 —— 光源数量
// 有上限(128),demo 规模下一次重算 <20ms,放置光源时的顿挫可接受。

const MAX_SOURCES = 128;
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

export class Lights {
  private readonly sources = new Map<string, { x: number; y: number; z: number; level: number }>();
  private light = new Map<string, number>();

  constructor(private readonly isOpaque: (x: number, y: number, z: number) => boolean) {}

  get sourceCount(): number {
    return this.sources.size;
  }

  lightAt(x: number, y: number, z: number): number {
    return this.light.get(key(x, y, z)) ?? 0;
  }

  /** 注册光源;超出上限返回 false(方块照放,只是不发光) */
  addSource(x: number, y: number, z: number, level: number): boolean {
    if (this.sources.size >= MAX_SOURCES) return false;
    this.sources.set(key(x, y, z), { x, y, z, level });
    return true;
  }

  removeSource(x: number, y: number, z: number): void {
    this.sources.delete(key(x, y, z));
  }

  /** 该位置的方块变化是否会影响光照(切比雪夫距离 15 内有光源) */
  affectedBy(x: number, y: number, z: number): boolean {
    for (const s of this.sources.values()) {
      if (
        Math.max(Math.abs(s.x - x), Math.abs(s.y - y), Math.abs(s.z - z)) <= 15
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * 全量重算:重播所有光源的 BFS,返回光值发生变化的格子列表
   * (供调用方把所在区块标脏重建网格)。
   */
  recompute(): Array<[number, number, number]> {
    const next = new Map<string, number>();
    for (const s of this.sources.values()) {
      this.spread(next, s.x, s.y, s.z, s.level);
    }
    // 差异 = 新旧任一方有而另一方不同的格子
    const changed: Array<[number, number, number]> = [];
    const collect = (k: string) => {
      const [x, y, z] = k.split(',').map(Number);
      changed.push([x, y, z]);
    };
    for (const [k, v] of next) {
      if (this.light.get(k) !== v) collect(k);
    }
    for (const k of this.light.keys()) {
      if (!next.has(k)) collect(k);
    }
    this.light = next;
    return changed;
  }

  /** 单光源 BFS:光能进入非不透明格,进入后向六邻衰减 1 继续 */
  private spread(out: Map<string, number>, sx: number, sy: number, sz: number, level: number): void {
    const queue: Array<[number, number, number, number]> = [[sx, sy, sz, level]];
    const seen = new Map<string, number>();
    seen.set(key(sx, sy, sz), level);
    while (queue.length > 0) {
      const [x, y, z, l] = queue.shift()!;
      const k = key(x, y, z);
      if ((out.get(k) ?? 0) < l) out.set(k, l);
      if (l <= 1) continue;
      for (const [dx, dy, dz] of [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        const nk = key(nx, ny, nz);
        const nl = l - 1;
        if ((seen.get(nk) ?? -1) >= nl) continue;
        if (this.isOpaque(nx, ny, nz)) continue; // 不透明方块挡光
        seen.set(nk, nl);
        queue.push([nx, ny, nz, nl]);
      }
    }
  }
}
