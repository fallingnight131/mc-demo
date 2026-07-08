// 地标结构(Terraria 3D · Phase 4):世界树 / 天空岛 / 地牢 / 地狱遗迹。
// 全部由种子确定性选址,按世界坐标盖章到区块 —— 跨区块一致,重复生成幂等。
import { Block } from './blocks';
import { LAYER_HELL_TOP, LAYER_SKY_BOTTOM, SEA_LEVEL, SNOW_LEVEL } from './config';
import { hash2, hash3 } from './noise';

/** 盖章写入器:世界坐标,越出当前区块的写入被调用方丢弃 */
export type SetFn = (x: number, y: number, z: number, id: number) => void;

/** 结构需要的地形查询(由 Generator 提供,避免循环依赖) */
export interface TerrainInfo {
  seed: number;
  heightAt(x: number, z: number): number;
  hellFloor(x: number, z: number): number;
  hellLava(x: number, z: number): number;
  biomeAt(x: number, z: number): 'forest' | 'jungle' | 'corruption' | 'crimson';
}

interface Box {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
}

export type LootTable = 'tree' | 'sky' | 'dungeon' | 'hell';

/** 宝箱战利品表(按所在地标) */
export const CHEST_LOOT: Record<LootTable, number[]> = {
  tree: [Block.Torch, Block.Torch, Block.Torch, Block.Plank, Block.Plank, Block.Glowstone, Block.GoldOre, Block.Pumpkin],
  sky: [Block.Glowstone, Block.Glowstone, Block.GoldBlock, Block.GoldBlock, Block.DiamondBlock, Block.Cloud, Block.Cloud, Block.Cloud],
  dungeon: [Block.TNT, Block.TNT, Block.IronBlock, Block.IronBlock, Block.GoldBlock, Block.Glowstone, Block.Glowstone, Block.DiamondOre, Block.DiamondOre],
  hell: [Block.Hellstone, Block.Hellstone, Block.Hellstone, Block.Obsidian, Block.Obsidian, Block.TNT, Block.TNT, Block.DiamondBlock, Block.Glowstone],
};

const TWO_PI = Math.PI * 2;

function angDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % TWO_PI;
  if (d > Math.PI) d = TWO_PI - d;
  return d;
}

export interface SkyIsland {
  x: number;
  z: number;
  y: number; // 岛面(草皮)高度
  r: number;
  /** 最大的一座:天池 + 带墙的空中神殿 */
  grand: boolean;
}

export class Structures {
  /** 世界树:树干中心与地面 */
  readonly tree: { x: number; z: number; ground: number };
  readonly islands: SkyIsland[] = [];
  /** 地牢入口(塔楼中心与地面) */
  readonly dungeon: { x: number; z: number; ground: number };
  readonly hellForts: Array<{ x: number; z: number; base: number; chest: boolean }> = [];
  private readonly boxes: Array<{ box: Box; loot: LootTable; build: (set: SetFn, soft: SetFn) => void }> = [];
  private readonly seed: number;

  constructor(private readonly t: TerrainInfo) {
    this.seed = t.seed;
    this.tree = this.placeTree();
    this.placeIslands();
    this.dungeon = this.placeDungeon();
    this.placeHellForts();

    const treeGround = this.tree.ground;
    const pf = treeGround + 62; // 树冠平台
    this.boxes.push({
      box: {
        x0: this.tree.x - 30, x1: this.tree.x + 30,
        z0: this.tree.z - 30, z1: this.tree.z + 30,
        y0: treeGround - 10, y1: pf + 20,
      },
      loot: 'tree',
      build: (set, soft) => this.buildTree(set, soft),
    });
    for (const isl of this.islands) {
      this.boxes.push({
        box: {
          x0: isl.x - isl.r - 2, x1: isl.x + isl.r + 2,
          z0: isl.z - isl.r - 2, z1: isl.z + isl.r + 2,
          y0: isl.y - isl.r - 2, y1: isl.y + 6,
        },
        loot: 'sky',
        build: (set, soft) => this.buildIsland(set, soft, isl),
      });
    }
    this.boxes.push({
      box: {
        x0: this.dungeon.x - 13, x1: this.dungeon.x + 13,
        z0: this.dungeon.z - 13, z1: this.dungeon.z + 13,
        y0: this.dungeon.ground - 27, y1: this.dungeon.ground + 9,
      },
      loot: 'dungeon',
      build: (set) => this.buildDungeon(set),
    });
    for (const f of this.hellForts) {
      this.boxes.push({
        box: { x0: f.x - 5, x1: f.x + 5, z0: f.z - 5, z1: f.z + 5, y0: 1, y1: 34 },
        loot: 'hell',
        build: (set) => this.buildHellFort(set, f.x, f.z, f.base, f.chest),
      });
    }
  }

  // ---------- 选址(全部确定性) ----------

  /**
   * 世界树:立于世界正中央 —— 大陆的轴心,出生点就在它脚下。
   * (诺斯替式世界之轴:从地下根系直抵天空层的巨木)
   */
  private placeTree(): { x: number; z: number; ground: number } {
    return { x: 0, z: 0, ground: this.t.heightAt(0, 0) };
  }

  /** 天空岛 ×6:大小悬殊,环绕大陆;首岛为巨岛(天池+神殿)。避开雪峰与世界树冠 */
  private placeIslands(): void {
    for (let i = 0; i < 6; i++) {
      const grand = i === 0;
      const ang = i * (TWO_PI / 6) + hash2(i, 7, this.seed ^ 0x51a11) * 0.8;
      const r = grand ? 24 : 10 + hash2(i, 29, this.seed ^ 0x51a13) * 7;
      const y = grand
        ? LAYER_SKY_BOTTOM + 8
        : LAYER_SKY_BOTTOM + 8 + Math.floor(hash2(i, 31, this.seed ^ 0x51a14) * 12);
      let placed = false;
      for (let attempt = 0; attempt < 8 && !placed; attempt++) {
        const dist =
          (grand ? 150 : 135) + hash2(i, 13, this.seed ^ 0x51a12) * 150 + attempt * 19;
        const x = Math.round(Math.cos(ang) * dist);
        const z = Math.round(Math.sin(ang) * dist);
        // 岛底(最深 12+云)不能扎进山顶
        let maxH = 0;
        for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
          maxH = Math.max(maxH, this.t.heightAt(x + Math.round(dx), z + Math.round(dz)));
        }
        if (maxH <= y - 19) {
          this.islands.push({ x, z, y, r, grand });
          placed = true;
        }
      }
      if (!placed) {
        // 兜底:退到山脉带外的外环平原上空(地势低,必然放得下)
        const dist = 310 + i * 7;
        this.islands.push({
          x: Math.round(Math.cos(ang) * dist),
          z: Math.round(Math.sin(ang) * dist),
          y,
          r,
          grand,
        });
      }
    }
  }

  /** 地牢:森林扇区的海岸带,找一块高于海面且相对平整的地 */
  private placeDungeon(): { x: number; z: number; ground: number } {
    const base = 5.15 + (hash2(9, 4, this.seed ^ 0xd0d0) - 0.5) * 0.5;
    let fallback: { x: number; z: number; ground: number } | null = null;
    for (const off of [0, 0.12, -0.12, 0.24, -0.24, 0.36, -0.36]) {
      const a = base + off;
      for (let d = 300; d <= 390; d += 5) {
        const x = Math.round(Math.cos(a) * d);
        const z = Math.round(Math.sin(a) * d);
        const h = this.t.heightAt(x, z);
        if (h < SEA_LEVEL + 4) continue;
        if (!fallback) fallback = { x, z, ground: h };
        let flat = true;
        for (const [dx, dz] of [[9, 9], [9, -9], [-9, 9], [-9, -9]]) {
          const hh = this.t.heightAt(x + dx, z + dz);
          if (hh < SEA_LEVEL + 1 || Math.abs(hh - h) > 7) flat = false;
        }
        if (flat) return { x, z, ground: h };
      }
    }
    return fallback ?? { x: 320, z: -180, ground: this.t.heightAt(320, -180) };
  }

  /**
   * 地狱黑曜石楼 ×8:密集分布、高低错落;三态基座——干岸楼(坐灰烬岸)、
   * 半埋楼(下部埋在灰烬块下)、浸浆楼(下部浸在岩浆里)。
   */
  private placeHellForts(): void {
    const N = 12; // 密集分布:地狱里常能遇到黑曜石楼
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TWO_PI + (hash2(i, 3, this.seed ^ 0xf0f1) - 0.5) * 0.5;
      const d = 42 + (i % 6) * 18 + hash2(i, 7, this.seed ^ 0xf0f5) * 14;
      const cx = Math.round(Math.cos(a) * d);
      const cz = Math.round(Math.sin(a) * d);
      const hf = this.t.hellFloor(cx, cz);
      const hl = this.t.hellLava(cx, cz);
      const kind = i % 3;
      let base: number;
      if (kind === 0) base = hf + 1; // 干岸楼:坐落灰烬岸上
      else if (kind === 1) base = hf - 4; // 半埋楼:下部埋在灰烬下
      else base = Math.min(hf, hl) - 3; // 浸浆楼:下部在岩浆/低洼里
      // 只有少数楼藏宝(大部分空楼):每 4 座一座藏宝楼
      this.hellForts.push({ x: cx, z: cz, base: Math.max(3, base), chest: i % 4 === 0 });
    }
  }

  // ---------- 对外查询 ----------

  /** 区块生成末尾调用:把与该区块相交的地标盖章进去 */
  stampChunk(ox: number, oz: number, set: SetFn, soft: SetFn): void {
    for (const { box, build } of this.boxes) {
      if (box.x1 < ox || box.x0 > ox + 15 || box.z1 < oz || box.z0 > oz + 15) continue;
      build(set, soft);
    }
  }

  /** 地表装饰抑制:世界树/地牢脚下不长树、不放南瓜 */
  suppressSurfaceAt(x: number, z: number): boolean {
    if (Math.hypot(x - this.tree.x, z - this.tree.z) <= 28) return true;
    if (Math.abs(x - this.dungeon.x) <= 14 && Math.abs(z - this.dungeon.z) <= 14) return true;
    return false;
  }

  /** 宝箱战利品表:按所在地标包围盒,盒外按深度兜底 */
  lootAt(x: number, y: number, z: number): LootTable {
    for (const { box, loot } of this.boxes) {
      if (x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1 && z >= box.z0 && z <= box.z1) {
        return loot;
      }
    }
    if (y < LAYER_HELL_TOP) return 'hell';
    if (y >= LAYER_SKY_BOTTOM) return 'sky';
    return 'tree';
  }

  // ---------- 盖章 ----------

  /**
   * 世界树(世界之轴):立于大陆正中央的诺斯替巨木。
   * 粗壮中空的树干从盘绕的根系直抵天空层,内壁螺旋台阶一路爬升,
   * 途中两间壁龛藏宝室;顶端是叶穹之下的王冠平台;
   * 八条巨枝托起花球状的层叠树冠 —— 远看如一颗西兰花。
   */
  private buildTree(set: SetFn, soft: SetFn): void {
    const { x: tx, z: tz, ground: g } = this.tree;
    const pf = g + 62; // 树冠平台
    const R_IN = 5.6; // 内腔半径
    const R_OUT = 8.6; // 干壁外径(壁厚 3,足以藏下壁龛)
    const rOutAt = (y: number) => R_OUT + Math.min(10, Math.max(0, (g + 4 - y) * 0.9));

    // 树干壳(根部外扩成盘绕根系)
    for (let y = g - 10; y < pf; y++) {
      const rOut = rOutAt(y);
      const ri = Math.ceil(rOut);
      for (let dx = -ri; dx <= ri; dx++) {
        for (let dz = -ri; dz <= ri; dz++) {
          const d = Math.hypot(dx, dz);
          if (d > rOut) continue;
          // 根部表面起伏:边缘按角度噪声镂空,根系呈放射瓣状
          if (y < g + 4 && d > rOut - 2.5) {
            const a = Math.atan2(dz, dx);
            if (Math.sin(a * 7 + (g + 4 - y) * 0.6) < -0.25) continue;
          }
          set(tx + dx, y, tz + dz, Block.Log);
        }
      }
    }
    // 内腔中空(贯通到树冠屋)+ 底层木地板
    for (let dx = -6; dx <= 6; dx++) {
      for (let dz = -6; dz <= 6; dz++) {
        if (Math.hypot(dx, dz) > R_IN) continue;
        for (let y = g + 1; y <= pf + 7; y++) set(tx + dx, y, tz + dz, Block.Air);
        set(tx + dx, g, tz + dz, Block.Plank);
      }
    }
    // 四向门洞(2 格宽 5 格高的哥特开口,世界之轴向四方敞开)
    for (const doorAng of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      for (let y = g + 1; y <= g + 5; y++) {
        const rOut = rOutAt(y) + 1.5;
        const ri = Math.ceil(rOut);
        for (let dx = -ri; dx <= ri; dx++) {
          for (let dz = -ri; dz <= ri; dz++) {
            const d = Math.hypot(dx, dz);
            if (d < 4.8 || d > rOut) continue;
            const w = y >= g + 5 ? 0.12 : 0.22; // 顶部收窄
            if (angDiff(Math.atan2(dz, dx), doorAng) < w) set(tx + dx, y, tz + dz, Block.Air);
          }
        }
      }
    }
    // 螺旋台阶(内壁盘旋,每级 2 格宽)+ 壁灯
    for (let k = 0; k <= pf - g - 2; k++) {
      const y = g + 1 + k;
      const th = 0.6 + k * 0.3;
      for (const r of [4.6, 5.4]) {
        set(tx + Math.round(Math.cos(th) * r), y, tz + Math.round(Math.sin(th) * r), Block.Plank);
      }
      if (k % 8 === 4) {
        set(
          tx + Math.round(Math.cos(th + 1.2) * 6.2),
          y + 1,
          tz + Math.round(Math.sin(th + 1.2) * 6.2),
          Block.Glowstone,
        );
      }
    }
    // 两间壁龛藏宝室(挖进 3 格厚的干壁,爬升途中的歇脚点)
    for (const [i, ay] of [g + 20, g + 42].entries()) {
      const aAng = 2.2 + i * 2.6;
      for (let y = ay; y <= ay + 2; y++) {
        for (let dx = -9; dx <= 9; dx++) {
          for (let dz = -9; dz <= 9; dz++) {
            const d = Math.hypot(dx, dz);
            if (d < R_IN - 0.4 || d > R_OUT - 0.8) continue;
            if (angDiff(Math.atan2(dz, dx), aAng) < 0.42) set(tx + dx, y, tz + dz, Block.Air);
          }
        }
      }
      const cx = tx + Math.round(Math.cos(aAng) * 7);
      const cz = tz + Math.round(Math.sin(aAng) * 7);
      set(cx, ay, cz, Block.Chest);
      set(cx, ay + 3, cz, Block.Glowstone);
    }
    // 底层中央宝箱
    set(tx, g + 1, tz, Block.Chest);

    // 八条巨枝(2×2 粗,向外上扬)+ 枝头花球 → 西兰花轮廓
    const canopyBase = pf + 6;
    const florets: Array<[number, number, number, number]> = [];
    for (let i = 0; i < 8; i++) {
      const bAng = 0.35 + i * (Math.PI / 4);
      const by = pf - 16 + (i % 3) * 4;
      const cos = Math.cos(bAng);
      const sin = Math.sin(bAng);
      let ex = tx;
      let ey = by;
      let ez = tz;
      for (let r = 5; r <= 17; r++) {
        ex = tx + Math.round(cos * r);
        ey = by + Math.round((r - 5) * 0.55);
        ez = tz + Math.round(sin * r);
        for (const [ox, oz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          set(ex + ox, ey, ez + oz, Block.Log);
          set(ex + ox, ey + 1, ez + oz, Block.Log);
        }
      }
      florets.push([ex, ey + 3, ez, 5 + hash2(i, 5, this.seed ^ 0xf10e) * 2.5]);
    }
    // 主树冠椭球 + 枝头花球(soft:只填空气,边缘噪声镂空)
    const blobs: Array<[number, number, number, number, number]> = [
      [tx, canopyBase, tz, 19, 11],
      ...florets.map(([fx, fy, fz, fr]) => [fx, fy, fz, fr, fr * 0.8] as [number, number, number, number, number]),
    ];
    for (const [bx, by, bz, brx, bry] of blobs) {
      const rxi = Math.ceil(brx) + 1;
      const ryi = Math.ceil(bry) + 1;
      for (let dy = -ryi; dy <= ryi; dy++) {
        for (let dx = -rxi; dx <= rxi; dx++) {
          for (let dz = -rxi; dz <= rxi; dz++) {
            const e = (dx * dx + dz * dz) / (brx * brx) + (dy * dy) / (bry * bry);
            if (e > 1) continue;
            if (e > 0.7 && hash3(bx + dx, by + dy, bz + dz, this.seed ^ 0x1eaf) < 0.38) continue;
            soft(bx + dx, by + dy, bz + dz, Block.Leaves);
          }
        }
      }
    }
    // 树冠王冠室:叶穹之下的环形平台(中心留台阶出口)+ 双宝箱 + 顶灯环
    for (let dx = -7; dx <= 7; dx++) {
      for (let dz = -7; dz <= 7; dz++) {
        const d = Math.hypot(dx, dz);
        if (d > 6.6) continue;
        for (let y = pf + 1; y <= pf + 7; y++) set(tx + dx, y, tz + dz, Block.Air);
        if (d > R_IN - 0.4) set(tx + dx, pf, tz + dz, Block.Plank);
      }
    }
    set(tx + 4, pf + 1, tz, Block.Chest);
    set(tx - 4, pf + 1, tz, Block.Chest);
    set(tx, pf + 8, tz, Block.Glowstone);
    for (const a of [0.8, 2.4, 4.0, 5.5]) {
      set(
        tx + Math.round(Math.cos(a) * 5),
        pf + 7,
        tz + Math.round(Math.sin(a) * 5),
        Block.Glowstone,
      );
    }
  }

  /**
   * 天空岛:草皮泥岩透镜体 + 底部云絮。
   * 岛上有湖(巨岛为天池),湖水从岛缘泻下、在半空消散成细流;
   * 巨岛立着带墙的空中神殿(箭窗砖墙 + 石砖穹案),小岛为神龛。
   */
  private buildIsland(set: SetFn, soft: SetFn, isl: SkyIsland): void {
    const { x: ix, z: iz, y: Y, r: R, grand } = isl;
    const ri = Math.ceil(R) + 1;
    // 湖:偏离岛心一侧;巨岛的天池更大
    const hasLake = grand || R >= 12;
    const lakeAng = hash2(isl.x, isl.z, this.seed ^ 0x1a4e) * TWO_PI;
    const lakeDist = grand ? 14 : R * 0.42;
    const lakeR = grand ? 7.5 : R * 0.28;
    const lx = Math.round(Math.cos(lakeAng) * lakeDist);
    const lz = Math.round(Math.sin(lakeAng) * lakeDist);

    for (let dx = -ri; dx <= ri; dx++) {
      for (let dz = -ri; dz <= ri; dz++) {
        const x = ix + dx;
        const z = iz + dz;
        const wobble = 1 + (hash2(x, z, this.seed ^ 0xc10d) - 0.5) * 0.25;
        const de = Math.hypot(dx, dz) * wobble;
        if (de > R) continue;
        const t = 1 - de / R;
        const depth = Math.min(12, Math.max(1, Math.round(Math.pow(t, 0.6) * R * 0.5)));
        const ld = hasLake ? Math.hypot(dx - lx, dz - lz) : 999;
        if (ld <= lakeR) {
          // 湖面与岛面齐平,湖心更深;湖底强制封石(防漏水)
          const wd = ld < lakeR * 0.55 ? 2 : 1;
          for (let k = 0; k < wd; k++) set(x, Y - k, z, Block.Water);
          set(x, Y - wd, z, Block.Stone);
          for (let k = wd + 1; k <= Math.max(depth, wd + 1); k++) {
            set(x, Y - k, z, Block.Stone);
          }
        } else {
          set(x, Y, z, Block.Grass);
          for (let k = 1; k <= depth; k++) {
            set(x, Y - k, z, k <= 2 ? Block.Dirt : Block.Stone);
          }
        }
        if (depth >= 2 && hash2(x, z, this.seed ^ 0xc10e) < 0.45) {
          set(x, Y - depth - 1, z, Block.Cloud);
        }
      }
    }
    // 岛缘细流:泉水泻下数格便在半空消散(静态装饰流水)。
    // 候选角逐个尝试,放满目标条数为止(边缘波动可能让个别角不可挂)
    const fallTarget = grand ? 4 : 2;
    let fallsPlaced = 0;
    for (let f = 0; f < 12 && fallsPlaced < fallTarget; f++) {
      const fa = lakeAng + 0.7 + f * (TWO_PI / 12) + hash2(f, 3, this.seed ^ 0xfa11) * 0.3;
      // 沿该方向找最外的岛面格,细流挂在它外侧
      let rim = -1;
      for (let r = R; r >= R * 0.5; r--) {
        const x = ix + Math.round(Math.cos(fa) * r);
        const z = iz + Math.round(Math.sin(fa) * r);
        const wobble = 1 + (hash2(x, z, this.seed ^ 0xc10d) - 0.5) * 0.25;
        if (Math.hypot(x - ix, z - iz) * wobble <= R) {
          rim = r;
          break;
        }
      }
      if (rim < 0) continue;
      // 细流挂在岛缘外第一个悬空格(躲开波动边缘的陆地)
      let wx = 0;
      let wz = 0;
      let found = false;
      for (let out = 1; out <= 3 && !found; out++) {
        wx = ix + Math.round(Math.cos(fa) * (rim + out));
        wz = iz + Math.round(Math.sin(fa) * (rim + out));
        const wobble = 1 + (hash2(wx, wz, this.seed ^ 0xc10d) - 0.5) * 0.25;
        if (Math.hypot(wx - ix, wz - iz) * wobble > R) found = true;
      }
      if (!found) continue;
      const drop = 3 + ((hash2(wx, wz, this.seed ^ 0xfa12) * 3) | 0);
      for (let k = 0; k <= drop; k++) {
        set(wx, Y - k, wz, k < drop - 1 ? Block.Flow2 : Block.Flow1);
      }
      fallsPlaced++;
    }
    if (grand) {
      // 空中神殿:13×13 带墙殿堂 —— 石砖地坪/檐口,砖墙嵌箭窗,穹顶灯
      for (let dx = -6; dx <= 6; dx++) {
        for (let dz = -6; dz <= 6; dz++) {
          const wall = Math.abs(dx) === 6 || Math.abs(dz) === 6;
          const corner = Math.abs(dx) === 6 && Math.abs(dz) === 6;
          set(ix + dx, Y, iz + dz, Block.StoneBrick);
          set(ix + dx, Y + 5, iz + dz, Block.StoneBrick);
          for (let y = Y + 1; y <= Y + 4; y++) {
            if (!wall) {
              set(ix + dx, y, iz + dz, Block.Air);
              continue;
            }
            // 箭窗:墙身中段每 3 格镂空一格
            const along = Math.abs(dx) === 6 ? dz : dx;
            const window = !corner && y === Y + 3 && ((along + 60) % 3 === 0);
            set(ix + dx, y, iz + dz, window ? Block.Air : corner ? Block.StoneBrick : Block.Brick);
          }
          if (wall && (dx + dz + 60) % 2 === 0) set(ix + dx, Y + 6, iz + dz, Block.StoneBrick);
        }
      }
      // 殿门(朝湖的反方向,2 宽 3 高)
      const da = lakeAng + Math.PI;
      const face: [number, number] =
        Math.abs(Math.cos(da)) > Math.abs(Math.sin(da))
          ? [Math.cos(da) > 0 ? 1 : -1, 0]
          : [0, Math.sin(da) > 0 ? 1 : -1];
      for (let y = Y + 1; y <= Y + 3; y++) {
        for (const w of [-1, 0]) {
          if (face[0] !== 0) set(ix + face[0] * 6, y, iz + w, Block.Air);
          else set(ix + w, y, iz + face[1] * 6, Block.Air);
        }
      }
      // 殿内:中央宝箱 + 金坛,穹顶灯 + 四角壁灯
      set(ix, Y + 1, iz, Block.Chest);
      set(ix - 2, Y + 1, iz, Block.GoldBlock);
      set(ix + 2, Y + 1, iz, Block.GoldBlock);
      set(ix, Y + 5, iz, Block.Glowstone);
      for (const [cx, cz] of [[-5, -5], [-5, 5], [5, -5], [5, 5]]) {
        set(ix + cx, Y + 4, iz + cz, Block.Glowstone);
      }
    } else {
      // 神龛:石砖地台 + 四砖柱 + 石砖顶,中央宝箱,顶上萤石灯塔
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          set(ix + dx, Y, iz + dz, Block.StoneBrick);
          set(ix + dx, Y + 4, iz + dz, Block.StoneBrick);
          for (let y = Y + 1; y <= Y + 3; y++) {
            const corner = Math.abs(dx) === 2 && Math.abs(dz) === 2;
            set(ix + dx, y, iz + dz, corner ? Block.Brick : Block.Air);
          }
        }
      }
      set(ix, Y + 1, iz, Block.Chest);
      set(ix, Y + 5, iz, Block.Glowstone);
    }
    void soft;
  }

  /**
   * 地牢:地表蓝砖塔楼,楼板中央的环形竖井盘旋而下,
   * 地下三层 3×3 房间迷宫(蛇形保证连通 + 随机额外门),
   * 房顶嵌萤石微光,角落房藏宝箱,底层为宝库。
   */
  private buildDungeon(set: SetFn): void {
    const { x: ex, z: ez, ground: eg } = this.dungeon;
    const B = Block.DungeonBrick;

    // 1. 地下实心体
    for (let y = eg - 26; y <= eg - 1; y++) {
      for (let dx = -12; dx <= 12; dx++) {
        for (let dz = -12; dz <= 12; dz++) set(ex + dx, y, ez + dz, B);
      }
    }
    // 2. 塔楼:楼板 + 四壁 + 顶板 + 城齿(角上萤石灯)
    for (let dx = -5; dx <= 5; dx++) {
      for (let dz = -5; dz <= 5; dz++) {
        set(ex + dx, eg, ez + dz, B);
        set(ex + dx, eg + 7, ez + dz, B);
        const wall = Math.abs(dx) === 5 || Math.abs(dz) === 5;
        for (let y = eg + 1; y <= eg + 6; y++) {
          set(ex + dx, y, ez + dz, wall ? B : Block.Air);
        }
        if (wall) {
          const corner = Math.abs(dx) === 5 && Math.abs(dz) === 5;
          if (corner) set(ex + dx, eg + 8, ez + dz, Block.Glowstone);
          else if (hash2(ex + dx, ez + dz, this.seed ^ 0xd003) < 0.5) set(ex + dx, eg + 8, ez + dz, B);
        }
      }
    }
    // 塔门(朝出生点方向的墙面,2 宽 3 高)
    const face: [number, number] = Math.abs(ex) > Math.abs(ez) ? (ex > 0 ? [-1, 0] : [1, 0]) : (ez > 0 ? [0, -1] : [0, 1]);
    for (let y = eg + 1; y <= eg + 3; y++) {
      for (const w of [-1, 0]) {
        if (face[0] !== 0) set(ex + face[0] * 5, y, ez + w, Block.Air);
        else set(ex + w, y, ez + face[1] * 5, Block.Air);
      }
    }
    // 塔内顶灯
    set(ex, eg + 6, ez, Block.Glowstone);

    // 3. 三层房间(每层 3×3,室内 7×7×5)
    const slabs = [eg - 11, eg - 18, eg - 25];
    for (let i = 0; i < 3; i++) {
      const S = slabs[i];
      for (let rx = 0; rx < 3; rx++) {
        for (let rz = 0; rz < 3; rz++) {
          const x0 = ex - 12 + rx * 8 + 1;
          const z0 = ez - 12 + rz * 8 + 1;
          for (let y = S + 1; y <= S + 5; y++) {
            for (let dx = 0; dx < 7; dx++) {
              for (let dz = 0; dz < 7; dz++) set(x0 + dx, y, z0 + dz, Block.Air);
            }
          }
          // 房顶萤石(隔间点亮,中央房是竖井跳过)
          if (!(rx === 1 && rz === 1) && (rx + rz + i) % 2 === 0) {
            set(ex - 12 + rx * 8 + 4, S + 6, ez - 12 + rz * 8 + 4, Block.Glowstone);
          }
        }
      }
      // 门:行内全通(x 向),行间蛇形换列 + 随机额外门(z 向)
      for (let rz = 0; rz < 3; rz++) {
        for (let rx = 0; rx < 2; rx++) {
          const wx = ex - 12 + (rx + 1) * 8;
          const zc = ez - 12 + rz * 8 + 4;
          for (let y = S + 1; y <= S + 3; y++) {
            set(wx, y, zc, Block.Air);
            set(wx, y, zc - 1, Block.Air);
          }
        }
      }
      for (let rz = 0; rz < 2; rz++) {
        for (let rx = 0; rx < 3; rx++) {
          const snake = rx === (rz % 2 === 0 ? 2 : 0);
          const extra = hash2(rx * 7 + i, rz * 3 + 11, this.seed ^ 0xd002) < 0.35;
          if (!snake && !extra) continue;
          const wz = ez - 12 + (rz + 1) * 8;
          const xc = ex - 12 + rx * 8 + 4;
          for (let y = S + 1; y <= S + 3; y++) {
            set(xc, y, wz, Block.Air);
            set(xc - 1, y, wz, Block.Air);
          }
        }
      }
    }
    // 4. 中央竖井:3×3 实心芯柱 + 环形通道 + 盘旋台阶(塔楼直通底层)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let y = eg - 26; y <= eg; y++) set(ex + dx, y, ez + dz, B);
      }
    }
    const ring: Array<[number, number]> = [];
    for (let dz = -2; dz <= 1; dz++) ring.push([2, dz]);
    for (let dx = 2; dx >= -1; dx--) ring.push([dx, 2]);
    for (let dz = 2; dz >= -1; dz--) ring.push([-2, dz]);
    for (let dx = -2; dx <= 1; dx++) ring.push([dx, -2]);
    for (const [dx, dz] of ring) {
      for (let y = eg - 24; y <= eg; y++) set(ex + dx, y, ez + dz, Block.Air);
    }
    for (let k = 0; k <= 23; k++) {
      const [dx, dz] = ring[k % 16];
      set(ex + dx, eg - 1 - k, ez + dz, B);
    }
    // 竖井壁灯(芯柱侧面)
    for (const y of [eg - 6, eg - 13, eg - 20]) set(ex + 1, y, ez, Block.Glowstone);

    // 5. 宝箱:上两层各 2 箱,底层四角宝库(金/钻镇场)
    const roomCenter = (rx: number, rz: number): [number, number] => [
      ex - 12 + rx * 8 + 4,
      ez - 12 + rz * 8 + 4,
    ];
    const chestRooms: Array<[number, number, number]> = [
      [0, 0, 0], [0, 2, 2],
      [1, 0, 2], [1, 2, 0],
      [2, 0, 0], [2, 0, 2], [2, 2, 0], [2, 2, 2],
    ];
    for (const [i, rx, rz] of chestRooms) {
      const [cx, cz] = roomCenter(rx, rz);
      set(cx, slabs[i] + 1, cz, Block.Chest);
      if (i === 2) {
        set(cx - 1, slabs[i] + 1, cz, Block.GoldBlock);
        set(cx + 1, slabs[i] + 1, cz, rx === rz ? Block.DiamondBlock : Block.GoldBlock);
      }
    }
  }

  /** 地狱黑曜石楼:两层黑曜石 + 四角地狱石光柱 + 箭窗;仅藏宝楼放宝箱(多数空楼) */
  private buildHellFort(set: SetFn, fx: number, fz: number, base: number, hasChest: boolean): void {
    const O = Block.Obsidian;
    const mid = base + 6; // 层间楼板
    const roof = base + 12; // 屋顶
    // 地台 + 裙脚
    for (let dx = -4; dx <= 4; dx++) {
      for (let dz = -4; dz <= 4; dz++) {
        set(fx + dx, base, fz + dz, O);
        if (Math.abs(dx) === 4 || Math.abs(dz) === 4) set(fx + dx, base - 1, fz + dz, O);
      }
    }
    // 两层楼:墙 + 层板 + 屋顶,四角地狱石光柱,箭窗,越高越残破
    for (let y = base + 1; y <= roof; y++) {
      for (let dx = -4; dx <= 4; dx++) {
        for (let dz = -4; dz <= 4; dz++) {
          const corner = Math.abs(dx) === 4 && Math.abs(dz) === 4;
          const edge = Math.abs(dx) === 4 || Math.abs(dz) === 4;
          if (corner) {
            // 四角地狱石光柱(自发光),顶端残破
            if (y < roof || hash3(fx + dx, y, fz + dz, this.seed ^ 0xf0f3) < 0.6) {
              set(fx + dx, y, fz + dz, Block.Hellstone);
            }
          } else if (edge) {
            // 箭窗(两层各一圈中点),其余越高越残破
            if ((y === base + 3 || y === base + 9) && (dx === 0 || dz === 0)) {
              set(fx + dx, y, fz + dz, Block.Air);
            } else {
              const ruin = hash3(fx + dx, y, fz + dz, this.seed ^ 0xf0f2) < (y - base) * 0.028;
              set(fx + dx, y, fz + dz, ruin ? Block.Air : O);
            }
          } else if (y === mid || y === roof) {
            set(fx + dx, y, fz + dz, O); // 层板 / 屋顶
          } else {
            set(fx + dx, y, fz + dz, Block.Air); // 室内清空
          }
        }
      }
    }
    // 一层门洞(+x)
    for (let y = base + 1; y <= base + 3; y++) {
      set(fx + 4, y, fz, Block.Air);
      set(fx + 4, y, fz - 1, Block.Air);
    }
    // 上楼开口(层板留洞)
    set(fx + 2, mid, fz + 2, Block.Air);
    set(fx + 2, mid, fz + 1, Block.Air);
    // 双层地灯(每座都有)
    set(fx, base, fz, Block.Glowstone);
    set(fx, mid, fz, Block.Glowstone);
    // 藏宝楼才放宝箱(一层两箱、二层两箱);多数为空楼,只是黑曜石建筑
    if (hasChest) {
      set(fx - 2, base + 1, fz, Block.Chest);
      set(fx + 2, base + 1, fz - 2, Block.Chest);
      set(fx - 2, mid + 1, fz - 1, Block.Chest);
      set(fx + 1, mid + 1, fz + 2, Block.Chest);
    }
  }
}
