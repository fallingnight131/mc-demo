// 体素块光照:光源(火把/萤石)BFS 传播,0..15 逐格衰减,不透明方块遮挡。
// 稀疏存储(只存 >0 的格子),整数键(字符串键的哈希/分配是热点)。
// 新增光源走单源增量传播(区块流入/放火把零卡顿);
// 移除光源或遮挡变化才全量重播,demo 规模一次几毫秒。

const MAX_SOURCES = 128;
// 键编码:x,z ∈ [-1024,1023](11 位),y ∈ [0,255](8 位),共 30 位
const key = (x: number, y: number, z: number) => (((x + 1024) << 19) | ((z + 1024) << 8) | y) | 0;
const keyX = (k: number) => (k >>> 19) - 1024;
const keyY = (k: number) => k & 255;
const keyZ = (k: number) => ((k >>> 8) & 2047) - 1024;

export class Lights {
  private readonly sources = new Map<number, { x: number; y: number; z: number; level: number }>();
  private light = new Map<number, number>();

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
   * 单源增量传播:把一个新光源直接并入现有光照(取 max),
   * 返回光值升高的格子列表。用于区块流入/放置光源,避免全量重算。
   */
  spreadInto(sx: number, sy: number, sz: number, level: number): Array<[number, number, number]> {
    const changed: Array<[number, number, number]> = [];
    this.spread(this.light, sx, sy, sz, level, (k) => {
      changed.push([keyX(k), keyY(k), keyZ(k)]);
    });
    return changed;
  }

  /**
   * 全量重算:重播所有光源的 BFS,返回光值发生变化的格子列表
   * (供调用方把所在区块标脏重建网格)。
   */
  recompute(): Array<[number, number, number]> {
    const next = new Map<number, number>();
    for (const s of this.sources.values()) {
      this.spread(next, s.x, s.y, s.z, s.level);
    }
    // 差异 = 新旧任一方有而另一方不同的格子
    const changed: Array<[number, number, number]> = [];
    const collect = (k: number) => {
      changed.push([keyX(k), keyY(k), keyZ(k)]);
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
  private spread(
    out: Map<number, number>,
    sx: number,
    sy: number,
    sz: number,
    level: number,
    onRaise?: (k: number) => void,
  ): void {
    const queue: Array<[number, number, number, number]> = [[sx, sy, sz, level]];
    const seen = new Map<number, number>();
    seen.set(key(sx, sy, sz), level);
    let head = 0; // 队列下标代替 shift(),避免 O(n²)
    while (head < queue.length) {
      const [x, y, z, l] = queue[head++];
      const k = key(x, y, z);
      if ((out.get(k) ?? 0) < l) {
        out.set(k, l);
        onRaise?.(k);
      }
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
