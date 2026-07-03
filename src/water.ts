// 简化水流模拟(拉取式元胞自动机)
// 规则:
//  - 水源恒为等级 4,只能由地形生成或被实体方块覆盖消除。
//  - 任意格子的目标水位 = max(上方是水 → 4,水平相邻水 - 1)。
//    水平贡献仅当邻居"落了地"(邻居下方不是空气);瀑布柱中段不横向扩散,
//    落地格按等级 3 向四周扩散,形成 MC 风格的窄瀑布 + 底部水洼。
//  - 目标水位 ≤ 0 时流水退去。只有被唤醒的格子参与计算,静水零开销。
import { Block, BLOCK_DEFS, flowId, isWater, waterLevel } from './blocks';
import type { Chunk } from './chunk';
import { WORLD_HEIGHT } from './config';
import type { World } from './world';

const TICK_INTERVAL = 0.2; // 秒
const MAX_ACTIVE = 6000; // 活跃格子上限,防失控
const SIDES: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const MAX_LANDINGS = 512;

export class WaterSim {
  /** 瀑布落点回调(本 tick 新落地的水格),用于溅水粒子 */
  onLanding: ((cells: Array<[number, number, number]>) => void) | null = null;
  private active = new Map<string, [number, number, number]>();
  /** 持久的瀑布落点(上有来水、下是实体的水格),供持续溅水采样 */
  private landings = new Map<string, [number, number, number]>();
  private acc = 0;

  constructor(private readonly world: World) {}

  private isLandingCell(x: number, y: number, z: number): boolean {
    return (
      isWater(this.world.getBlock(x, y, z)) &&
      isWater(this.world.getBlock(x, y + 1, z)) &&
      BLOCK_DEFS[this.world.getBlock(x, y - 1, z)].solid
    );
  }

  private refreshLanding(x: number, y: number, z: number): void {
    const k = x + ',' + y + ',' + z;
    if (this.isLandingCell(x, y, z)) {
      if (this.landings.size < MAX_LANDINGS) this.landings.set(k, [x, y, z]);
    } else {
      this.landings.delete(k);
    }
  }

  /** 随机采样至多 n 个距 (px,pz) 不超过 radius 的有效落点,顺带清理失效项 */
  sampleLandings(
    n: number,
    px: number,
    pz: number,
    radius: number,
  ): Array<[number, number, number]> {
    const out: Array<[number, number, number]> = [];
    if (this.landings.size === 0) return out;
    const keys = [...this.landings.keys()];
    for (let i = 0; i < n * 4 && out.length < n; i++) {
      const k = keys[(Math.random() * keys.length) | 0];
      const c = this.landings.get(k);
      if (!c) continue;
      if (!this.isLandingCell(c[0], c[1], c[2])) {
        this.landings.delete(k);
        continue;
      }
      if (Math.hypot(c[0] - px, c[2] - pz) > radius) continue;
      out.push(c);
    }
    return out;
  }

  /** 最近瀑布落点的距离(无落点则 Infinity),用于流水氛围声 */
  nearestLandingDist(px: number, py: number, pz: number): number {
    let best = Infinity;
    for (const [x, y, z] of this.landings.values()) {
      const d = Math.hypot(x + 0.5 - px, y + 0.5 - py, z + 0.5 - pz);
      if (d < best) best = d;
    }
    return best;
  }

  /** 唤醒某格及其六邻(方块变化时调用) */
  wakeAround(x: number, y: number, z: number): void {
    this.wake(x, y, z);
    this.wake(x + 1, y, z);
    this.wake(x - 1, y, z);
    this.wake(x, y + 1, z);
    this.wake(x, y - 1, z);
    this.wake(x, y, z + 1);
    this.wake(x, y, z - 1);
  }

  wake(x: number, y: number, z: number): void {
    if (y < 1 || y >= WORLD_HEIGHT) return;
    if (this.active.size >= MAX_ACTIVE) return;
    this.active.set(x + ',' + y + ',' + z, [x, y, z]);
  }

  get activeCount(): number {
    return this.active.size;
  }

  update(dt: number): void {
    this.acc += dt;
    if (this.acc > 1) this.acc = TICK_INTERVAL; // 帧率骤降时不补流
    while (this.acc >= TICK_INTERVAL) {
      this.acc -= TICK_INTERVAL;
      this.tick();
    }
  }

  /** 单步推演(公开以便测试) */
  tick(): void {
    if (this.active.size === 0) return;
    const cells = [...this.active.values()];
    this.active.clear();

    // 先基于同一快照计算,再统一落盘,避免格子处理顺序影响结果
    const changes: Array<[number, number, number, number]> = [];
    for (const [x, y, z] of cells) {
      const id = this.world.getBlock(x, y, z);
      if (id === Block.Water) continue; // 水源不衰减
      if (id !== Block.Air && !isWater(id)) continue; // 被实体方块占据

      const lvl = this.computeLevel(x, y, z);
      const targetId = lvl <= 0 ? Block.Air : flowId(lvl);
      if (targetId !== id) changes.push([x, y, z, targetId]);
    }
    if (changes.length === 0) return;

    const dirty = new Set<Chunk>();
    const landings: Array<[number, number, number]> = [];
    for (const [x, y, z, id] of changes) {
      if (!this.world.setRaw(x, y, z, id, dirty)) continue;
      this.wakeAround(x, y, z);
      // 新落地的水(上有来水、下是实体)→ 溅水点
      if (
        landings.length < 8 &&
        isWater(id) &&
        isWater(this.world.getBlock(x, y + 1, z)) &&
        BLOCK_DEFS[this.world.getBlock(x, y - 1, z)].solid
      ) {
        landings.push([x, y, z]);
      }
    }
    this.world.remeshChunks(dirty);
    // 刷新本 tick 涉及格子的"瀑布落点"标记(供持续溅水)
    for (const [x, y, z] of cells) this.refreshLanding(x, y, z);
    for (const [x, y, z] of changes) this.refreshLanding(x, y, z);
    if (landings.length && this.onLanding) this.onLanding(landings);
  }

  private computeLevel(x: number, y: number, z: number): number {
    if (isWater(this.world.getBlock(x, y + 1, z))) return 4; // 上方来水,灌满
    let best = 0;
    for (const [dx, dz] of SIDES) {
      const nid = this.world.getBlock(x + dx, y, z + dz);
      if (!isWater(nid)) continue;
      const below = this.world.getBlock(x + dx, y - 1, z + dz);
      const falling = isWater(this.world.getBlock(x + dx, y + 1, z + dz));
      if (falling) {
        // 瀑布中段不横向供水;落地格(下方是实体)作为等级 3 扩散源
        if (BLOCK_DEFS[below].solid) best = Math.max(best, 3);
      } else if (below !== Block.Air) {
        best = Math.max(best, waterLevel(nid) - 1);
      }
    }
    return best;
  }
}
