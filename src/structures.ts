// 地标结构(Terraria 3D · Phase 4):世界树 / 天空岛 / 地牢 / 地狱遗迹。
// 全部由种子确定性选址,按世界坐标盖章到区块 —— 跨区块一致,重复生成幂等。
import { Block } from './blocks';
import { LAVA_LEVEL, LAYER_HELL_TOP, LAYER_SKY_BOTTOM, SEA_LEVEL, SNOW_LEVEL } from './config';
import { hash2, hash3 } from './noise';

/** 盖章写入器:世界坐标,越出当前区块的写入被调用方丢弃 */
export type SetFn = (x: number, y: number, z: number, id: number) => void;

/** 结构需要的地形查询(由 Generator 提供,避免循环依赖) */
export interface TerrainInfo {
  seed: number;
  heightAt(x: number, z: number): number;
  hellFloor(x: number, z: number): number;
  biomeAt(x: number, z: number): 'forest' | 'jungle' | 'corruption';
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
}

export class Structures {
  /** 世界树:树干中心与地面 */
  readonly tree: { x: number; z: number; ground: number };
  readonly islands: SkyIsland[] = [];
  /** 地牢入口(塔楼中心与地面) */
  readonly dungeon: { x: number; z: number; ground: number };
  readonly hellForts: Array<{ x: number; z: number }> = [];
  private readonly boxes: Array<{ box: Box; loot: LootTable; build: (set: SetFn, soft: SetFn) => void }> = [];
  private readonly seed: number;

  constructor(private readonly t: TerrainInfo) {
    this.seed = t.seed;
    this.tree = this.placeTree();
    this.placeIslands();
    this.dungeon = this.placeDungeon();
    this.placeHellForts();

    const treeGround = this.tree.ground;
    const pf = treeGround + 44; // 树顶平台
    this.boxes.push({
      box: {
        x0: this.tree.x - 16, x1: this.tree.x + 16,
        z0: this.tree.z - 16, z1: this.tree.z + 16,
        y0: treeGround - 8, y1: pf + 13,
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
        box: { x0: f.x - 5, x1: f.x + 5, z0: f.z - 5, z1: f.z + 5, y0: 8, y1: 18 },
        loot: 'hell',
        build: (set) => this.buildHellFort(set, f.x, f.z),
      });
    }
  }

  // ---------- 选址(全部确定性) ----------

  /** 世界树:出生盆地内(d≈85),扫方位角找一块高于海面的平地 */
  private placeTree(): { x: number; z: number; ground: number } {
    const a0 = hash2(3, 11, this.seed ^ 0x77e3) * TWO_PI;
    for (let k = 0; k < 48; k++) {
      const a = a0 + k * 0.131;
      const x = Math.round(Math.cos(a) * 85);
      const z = Math.round(Math.sin(a) * 85);
      const h = this.t.heightAt(x, z);
      if (h <= SEA_LEVEL + 2 || h >= SNOW_LEVEL - 10) continue;
      // 根部范围内不要有大落差(湖边/陡坡)
      let ok = true;
      for (const [dx, dz] of [[8, 0], [-8, 0], [0, 8], [0, -8]]) {
        const hh = this.t.heightAt(x + dx, z + dz);
        if (hh <= SEA_LEVEL + 1 || Math.abs(hh - h) > 6) ok = false;
      }
      if (ok) return { x, z, ground: h };
    }
    return { x: 85, z: 0, ground: this.t.heightAt(85, 0) };
  }

  /** 天空岛 ×5:环绕大陆分布,避开雪峰(山顶不得顶进岛底) */
  private placeIslands(): void {
    for (let i = 0; i < 5; i++) {
      const ang = i * (TWO_PI / 5) + hash2(i, 7, this.seed ^ 0x51a11) * 0.9;
      const r = 9 + hash2(i, 29, this.seed ^ 0x51a13) * 5;
      const y = LAYER_SKY_BOTTOM + 8 + Math.floor(hash2(i, 31, this.seed ^ 0x51a14) * 12);
      for (let attempt = 0; attempt < 8; attempt++) {
        const dist = 135 + hash2(i, 13, this.seed ^ 0x51a12) * 165 + attempt * 19;
        const x = Math.round(Math.cos(ang) * dist);
        const z = Math.round(Math.sin(ang) * dist);
        // 岛底(最深 ~r*0.55+云)不能扎进山顶
        let maxH = 0;
        for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
          maxH = Math.max(maxH, this.t.heightAt(x + Math.round(dx), z + Math.round(dz)));
        }
        if (maxH <= y - r * 0.55 - 6) {
          this.islands.push({ x, z, y, r });
          break;
        }
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

  /** 地狱遗迹 ×3:在灰烬岸(hellFloor 高于岩浆)上找落脚点 */
  private placeHellForts(): void {
    for (let i = 0; i < 3; i++) {
      const a = hash2(i, 3, this.seed ^ 0xf0f1) * TWO_PI;
      const d = 100 + i * 85;
      const cx = Math.round(Math.cos(a) * d);
      const cz = Math.round(Math.sin(a) * d);
      outer: for (let ring = 0; ring <= 64; ring += 3) {
        for (let dx = -ring; dx <= ring; dx += 3) {
          for (let dz = -ring; dz <= ring; dz += 3) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
            const x = cx + dx;
            const z = cz + dz;
            // 中心在灰烬岸上,门前(+x)可落脚;边角允许探进岩浆(残垣戏剧感)
            const ok =
              this.t.hellFloor(x, z) >= LAVA_LEVEL + 1 &&
              this.t.hellFloor(x + 5, z) >= LAVA_LEVEL;
            if (ok) {
              this.hellForts.push({ x, z });
              break outer;
            }
          }
        }
      }
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
    if (Math.hypot(x - this.tree.x, z - this.tree.z) <= 17) return true;
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
   * 世界树:根部外扩的中空巨木,内壁螺旋台阶通往树冠平台,
   * 底/顶设宝箱,树冠为巨大树叶椭球。门朝出生点。
   */
  private buildTree(set: SetFn, soft: SetFn): void {
    const { x: tx, z: tz, ground: g } = this.tree;
    const pf = g + 44;
    const R_IN = 3.2;
    const doorAng = Math.atan2(-tz, -tx);
    const rOutAt = (y: number) => 5.2 + Math.min(6, Math.max(0, (g + 3 - y) * 0.6));

    // 树干壳(含根部外扩)
    for (let y = g - 8; y < pf; y++) {
      const rOut = rOutAt(y);
      const ri = Math.ceil(rOut);
      for (let dx = -ri; dx <= ri; dx++) {
        for (let dz = -ri; dz <= ri; dz++) {
          if (Math.hypot(dx, dz) <= rOut) set(tx + dx, y, tz + dz, Block.Log);
        }
      }
    }
    // 内部中空(贯通到树冠屋)+ 底层木地板
    for (let dx = -4; dx <= 4; dx++) {
      for (let dz = -4; dz <= 4; dz++) {
        if (Math.hypot(dx, dz) > R_IN) continue;
        for (let y = g + 1; y <= pf + 5; y++) set(tx + dx, y, tz + dz, Block.Air);
        set(tx + dx, g, tz + dz, Block.Plank);
      }
    }
    // 门洞(朝出生点,只切壳体)
    for (let y = g + 1; y <= g + 4; y++) {
      const rOut = rOutAt(y) + 1;
      const ri = Math.ceil(rOut);
      for (let dx = -ri; dx <= ri; dx++) {
        for (let dz = -ri; dz <= ri; dz++) {
          const d = Math.hypot(dx, dz);
          if (d < 2.6 || d > rOut) continue;
          if (angDiff(Math.atan2(dz, dx), doorAng) < 0.4) set(tx + dx, y, tz + dz, Block.Air);
        }
      }
    }
    // 螺旋台阶(每级 2 格宽)+ 壁灯
    for (let k = 0; k <= pf - g - 2; k++) {
      const y = g + 1 + k;
      const th = doorAng + Math.PI + k * 0.55;
      for (const r of [2.2, 3.0]) {
        set(tx + Math.round(Math.cos(th) * r), y, tz + Math.round(Math.sin(th) * r), Block.Plank);
      }
      if (k % 9 === 4) {
        set(
          tx + Math.round(Math.cos(th + 1.4) * 3.6),
          y + 1,
          tz + Math.round(Math.sin(th + 1.4) * 3.6),
          Block.Glowstone,
        );
      }
    }
    // 底层宝箱
    set(tx, g + 1, tz, Block.Chest);
    // 枝干(树冠内的放射原木)
    for (let i = 0; i < 5; i++) {
      const bAng = doorAng + 0.6 + i * 1.257;
      const by = pf - 3 - (i % 3) * 4;
      for (let r = 4; r <= 11; r++) {
        set(
          tx + Math.round(Math.cos(bAng) * r),
          by + (r >> 2),
          tz + Math.round(Math.sin(bAng) * r),
          Block.Log,
        );
      }
    }
    // 树冠椭球(只填空气,边缘噪声镂空)
    const cy = pf + 4;
    const RX = 13;
    const RY = 7;
    for (let dy = -RY - 1; dy <= RY + 1; dy++) {
      for (let dx = -RX - 1; dx <= RX + 1; dx++) {
        for (let dz = -RX - 1; dz <= RX + 1; dz++) {
          const e = (dx * dx + dz * dz) / (RX * RX) + (dy * dy) / (RY * RY);
          if (e > 1) continue;
          if (e > 0.72 && hash3(tx + dx, cy + dy, tz + dz, this.seed ^ 0x1eaf) < 0.35) continue;
          soft(tx + dx, cy + dy, tz + dz, Block.Leaves);
        }
      }
    }
    // 树冠屋:重新掏空 + 环形平台(中心留台阶出口)+ 双宝箱 + 顶灯
    for (let dx = -5; dx <= 5; dx++) {
      for (let dz = -5; dz <= 5; dz++) {
        const d = Math.hypot(dx, dz);
        if (d > 4.6) continue;
        for (let y = pf + 1; y <= pf + 5; y++) set(tx + dx, y, tz + dz, Block.Air);
        if (d > 2.8) set(tx + dx, pf, tz + dz, Block.Plank);
      }
    }
    set(tx + 3, pf + 1, tz, Block.Chest);
    set(tx - 3, pf + 1, tz, Block.Chest);
    set(tx, pf + 6, tz, Block.Glowstone);
  }

  /** 天空岛:草皮泥岩透镜体 + 底部云絮;石砖神龛藏宝箱,顶置萤石灯塔 */
  private buildIsland(set: SetFn, soft: SetFn, isl: SkyIsland): void {
    const { x: ix, z: iz, y: Y, r: R } = isl;
    const ri = Math.ceil(R) + 1;
    for (let dx = -ri; dx <= ri; dx++) {
      for (let dz = -ri; dz <= ri; dz++) {
        const x = ix + dx;
        const z = iz + dz;
        const wobble = 1 + (hash2(x, z, this.seed ^ 0xc10d) - 0.5) * 0.25;
        const de = Math.hypot(dx, dz) * wobble;
        if (de > R) continue;
        const t = 1 - de / R;
        const depth = Math.max(1, Math.round(Math.pow(t, 0.6) * R * 0.55));
        set(x, Y, z, Block.Grass);
        for (let k = 1; k <= depth; k++) {
          set(x, Y - k, z, k <= 2 ? Block.Dirt : Block.Stone);
        }
        if (depth >= 2 && hash2(x, z, this.seed ^ 0xc10e) < 0.45) {
          set(x, Y - depth - 1, z, Block.Cloud);
        }
      }
    }
    // 神龛:石砖地台 + 四柱(首岛金柱)+ 石砖顶,中央宝箱,顶上萤石
    const pillar = this.islands.indexOf(isl) === 0 ? Block.GoldBlock : Block.Brick;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        set(ix + dx, Y, iz + dz, Block.StoneBrick);
        set(ix + dx, Y + 4, iz + dz, Block.StoneBrick);
        for (let y = Y + 1; y <= Y + 3; y++) {
          const corner = Math.abs(dx) === 2 && Math.abs(dz) === 2;
          set(ix + dx, y, iz + dz, corner ? pillar : Block.Air);
        }
      }
    }
    set(ix, Y + 1, iz, Block.Chest);
    set(ix, Y + 5, iz, Block.Glowstone);
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

  /** 地狱遗迹:灰烬岸上的黑曜石断壁残垣,地狱石棱角,内藏宝箱 */
  private buildHellFort(set: SetFn, fx: number, fz: number): void {
    const base = LAVA_LEVEL + 2;
    // 地台 + 边缘裙脚
    for (let dx = -4; dx <= 4; dx++) {
      for (let dz = -4; dz <= 4; dz++) {
        set(fx + dx, base, fz + dz, Block.Obsidian);
        if (Math.abs(dx) === 4 || Math.abs(dz) === 4) {
          set(fx + dx, base - 1, fz + dz, Block.Obsidian);
        }
      }
    }
    // 内部清空
    for (let y = base + 1; y <= base + 5; y++) {
      for (let dx = -3; dx <= 3; dx++) {
        for (let dz = -3; dz <= 3; dz++) set(fx + dx, y, fz + dz, Block.Air);
      }
    }
    // 断墙:越高越残破;四角地狱石(自发光)
    for (let y = base + 1; y <= base + 6; y++) {
      for (let dx = -4; dx <= 4; dx++) {
        for (let dz = -4; dz <= 4; dz++) {
          if (Math.abs(dx) !== 4 && Math.abs(dz) !== 4) continue;
          const corner = Math.abs(dx) === 4 && Math.abs(dz) === 4;
          if (!corner && hash3(fx + dx, y, fz + dz, this.seed ^ 0xf0f2) < 0.06 + (y - base - 1) * 0.1) continue;
          if (corner && y > base + 4) continue;
          set(fx + dx, y, fz + dz, corner ? Block.Hellstone : Block.Obsidian);
        }
      }
    }
    // 门洞
    for (let y = base + 1; y <= base + 3; y++) {
      set(fx + 4, y, fz, Block.Air);
      set(fx + 4, y, fz - 1, Block.Air);
    }
    // 宝箱与地灯
    set(fx - 2, base + 1, fz, Block.Chest);
    set(fx + 2, base + 1, fz - 2, Block.Chest);
    set(fx, base, fz, Block.Glowstone);
  }
}
