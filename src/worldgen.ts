// 程序化地形生成:高度场 + 海洋/沙滩/雪山 + 树木
// 全部基于世界坐标的确定性函数,保证跨区块一致。
import { Block } from './blocks';
import {
  CHUNK_SIZE,
  COAST_WIDTH,
  CONTINENT_RADIUS,
  RANGE_INNER,
  RANGE_OUTER,
  SEA_LEVEL,
  SNOW_LEVEL,
  WORLD_HEIGHT,
} from './config';
import { hash2, hash3, Noise2D } from './noise';

const CS = CHUNK_SIZE;
const WH = WORLD_HEIGHT;
const TREE_MARGIN = 3; // 树冠可越界的范围,生成时向外多扫描

function smooth01(e0: number, e1: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export class Generator {
  readonly seed: number;
  private readonly hills: Noise2D;
  private readonly mountains: Noise2D;
  private readonly coast: Noise2D;

  constructor(seed: number) {
    this.seed = seed;
    this.hills = new Noise2D(seed);
    this.mountains = new Noise2D(seed ^ 0x5bd1e995);
    this.coast = new Noise2D(seed ^ 0x27d4eb2f);
  }

  /**
   * 地表高度 —— Terraria 3D 结构化大陆:
   * 出生地(世界中心)为平缓森林,四周一圈蜿蜒的环形山脉(带山口),
   * 大陆经噪声扰动的海岸线缓降入海,海面一直延伸到空气墙。
   */
  heightAt(x: number, z: number): number {
    const d = Math.hypot(x, z);
    // 海岸线随位置噪声起伏 ±55
    const coastWobble = this.coast.fbm(x * 0.004, z * 0.004, 3) * 55;
    const coastR = CONTINENT_RADIUS + coastWobble;
    // 陆地系数:内陆 1 → 海 0
    const land = smooth01(coastR, coastR - COAST_WIDTH, d);
    // 海底:离岸越远越深(最深至海平面下 12)
    const seabed = SEA_LEVEL - 3 - Math.min(9, Math.max(0, (d - coastR + 26) * 0.09));

    // 内陆:平缓丘陵 + 环形山脉带
    const base = 27 + this.hills.fbm(x * 0.012, z * 0.012, 4) * 7;
    const mid = (RANGE_INNER + RANGE_OUTER) / 2;
    const halfW = (RANGE_OUTER - RANGE_INNER) / 2;
    const ringDist = Math.abs(d - mid) / halfW; // 0 = 山脉带中央
    // 山口:角向噪声偏低处山脉断开,留出通往海岸的谷道
    const gap = this.mountains.fbm(x * 0.003 + 7.3, z * 0.003 - 3.1, 2);
    const mask = smooth01(1, 0.55, ringDist) * smooth01(-0.38, -0.12, gap);
    // 脊状噪声:连绵山脊而非随机圆包
    const r = 1 - Math.abs(this.mountains.fbm(x * 0.006, z * 0.006, 4));
    const ridge = Math.pow(Math.max(0, r), 2.2);
    const landH = base + ridge * mask * 46;

    const h = seabed * (1 - land) + landH * land;
    return Math.max(2, Math.min(WH - 16, Math.floor(h)));
  }

  hasTree(x: number, z: number): boolean {
    return hash2(x, z, this.seed ^ 0x51ab3) < 0.007;
  }

  /** 石头层中按深度概率撒矿石(确定性,越深越稀有的矿越多) */
  oreAt(x: number, y: number, z: number): number {
    const r = hash3(x, y, z, this.seed ^ 0x0135a);
    if (y <= 14 && r < 0.0022) return Block.DiamondOre;
    if (y <= 22 && r < 0.0058) return Block.GoldOre;
    if (y <= 42 && r < 0.014) return Block.IronOre;
    if (r < 0.026) return Block.CoalOre;
    return Block.Stone;
  }

  /** 草地上稀有的野生南瓜 */
  hasPumpkin(x: number, z: number): boolean {
    return hash2(x, z, this.seed ^ 0x7a111) < 0.0016;
  }

  private treeHeight(x: number, z: number): number {
    return 4 + Math.floor(hash2(x, z, this.seed ^ 0x9e37) * 3);
  }

  generateChunk(cx: number, cz: number): Uint8Array {
    const data = new Uint8Array(CS * CS * WH);
    const ox = cx * CS;
    const oz = cz * CS;

    const idx = (lx: number, y: number, lz: number) => (y * CS + lz) * CS + lx;
    const inBounds = (lx: number, y: number, lz: number) =>
      lx >= 0 && lx < CS && lz >= 0 && lz < CS && y >= 0 && y < WH;
    const set = (lx: number, y: number, lz: number, id: number) => {
      if (inBounds(lx, y, lz)) data[idx(lx, y, lz)] = id;
    };
    const setIfSoft = (lx: number, y: number, lz: number, id: number) => {
      if (!inBounds(lx, y, lz)) return;
      const cur = data[idx(lx, y, lz)];
      if (cur === Block.Air || cur === Block.Water) data[idx(lx, y, lz)] = id;
    };

    // 地形柱
    for (let lz = 0; lz < CS; lz++) {
      for (let lx = 0; lx < CS; lx++) {
        const wx = ox + lx;
        const wz = oz + lz;
        const h = this.heightAt(wx, wz);
        const sandy = h <= SEA_LEVEL + 1;
        const snowy = h >= SNOW_LEVEL;
        for (let y = 0; y <= h; y++) {
          let id: number;
          if (y === 0) id = Block.Bedrock;
          else if (y < h - 3) id = this.oreAt(wx, y, wz);
          else if (y < h) id = sandy ? Block.Sand : Block.Dirt;
          else id = sandy ? Block.Sand : snowy ? Block.Snow : Block.Grass;
          data[idx(lx, y, lz)] = id;
        }
        for (let y = h + 1; y <= SEA_LEVEL; y++) {
          data[idx(lx, y, lz)] = Block.Water;
        }
        // 草地上的野生南瓜(避开树),朝向按位置确定性随机
        if (!sandy && !snowy && h > SEA_LEVEL + 1 && !this.hasTree(wx, wz) && this.hasPumpkin(wx, wz)) {
          const face = [Block.Pumpkin, Block.PumpkinE, Block.PumpkinN, Block.PumpkinW];
          data[idx(lx, h + 1, lz)] = face[(hash2(wx, wz, this.seed ^ 0x9c1a) * 4) | 0];
        }
      }
    }

    // 树木:连同边缘外 TREE_MARGIN 格的候选一起处理,保证树冠跨区块一致。
    // 先铺树叶(仅覆盖空气/水),再立树干(无条件覆盖),结果与处理顺序无关。
    for (let tz = -TREE_MARGIN; tz < CS + TREE_MARGIN; tz++) {
      for (let tx = -TREE_MARGIN; tx < CS + TREE_MARGIN; tx++) {
        const wx = ox + tx;
        const wz = oz + tz;
        if (!this.hasTree(wx, wz)) continue;
        const h = this.heightAt(wx, wz);
        if (h <= SEA_LEVEL + 1 || h >= SNOW_LEVEL - 4) continue;

        const ht = this.treeHeight(wx, wz);
        const topY = h + ht;
        for (let ly = topY - 2; ly <= topY + 1; ly++) {
          const r = ly <= topY - 1 ? 2 : 1;
          for (let oxl = -r; oxl <= r; oxl++) {
            for (let ozl = -r; ozl <= r; ozl++) {
              if (oxl === 0 && ozl === 0 && ly <= topY) continue; // 树干位置
              // 顶层只保留十字形
              if (ly === topY + 1 && Math.abs(oxl) + Math.abs(ozl) > 1) continue;
              // 大层四角随机裁掉,形状更自然(基于世界坐标确定性)
              if (
                Math.abs(oxl) === 2 &&
                Math.abs(ozl) === 2 &&
                hash2(wx + oxl + ly * 57, wz + ozl + ly * 131, this.seed ^ 0x77aa) < 0.5
              ) {
                continue;
              }
              setIfSoft(tx + oxl, ly, tz + ozl, Block.Leaves);
            }
          }
        }
        for (let y = h + 1; y <= topY; y++) {
          set(tx, y, tz, Block.Log);
        }
      }
    }

    return data;
  }

  /** 从原点向外找一个适合出生的草地柱(避开树木与陡坡) */
  findSpawn(): { x: number; y: number; z: number } {
    for (let r = 0; r < 64; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const h = this.heightAt(dx, dz);
          if (h <= SEA_LEVEL + 1 || h >= SNOW_LEVEL) continue;
          if (this.hasPumpkin(dx, dz)) continue; // 别出生在南瓜里
          let clear = true;
          // 周围 6 格内不能有树(树冠半径 2,留出起步活动空间)
          for (let tx = -6; tx <= 6 && clear; tx++) {
            for (let tz = -6; tz <= 6 && clear; tz++) {
              if (this.hasTree(dx + tx, dz + tz)) clear = false;
            }
          }
          // 身边一圈不要有陡坎
          for (let tx = -1; tx <= 1 && clear; tx++) {
            for (let tz = -1; tz <= 1 && clear; tz++) {
              if (Math.abs(this.heightAt(dx + tx, dz + tz) - h) > 1) clear = false;
            }
          }
          if (clear) return { x: dx + 0.5, y: h + 1.01, z: dz + 0.5 };
        }
      }
    }
    return { x: 0.5, y: WH - 20, z: 0.5 };
  }
}
