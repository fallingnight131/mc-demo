// 程序化地形生成:高度场 + 海洋/沙滩/雪山 + 树木
// 全部基于世界坐标的确定性函数,保证跨区块一致。
import { Block } from './blocks';
import {
  CHUNK_SIZE,
  COAST_WIDTH,
  CONTINENT_RADIUS,
  LAVA_LEVEL,
  LAYER_HELL_TOP,
  RANGE_INNER,
  RANGE_OUTER,
  SEA_LEVEL,
  SNOW_LEVEL,
  WORLD_HEIGHT,
} from './config';
import { hash2, hash3, Noise2D, Noise3D } from './noise';
import { Structures } from './structures';

const CS = CHUNK_SIZE;
const WH = WORLD_HEIGHT;
const TREE_MARGIN = 3; // 树冠可越界的范围,生成时向外多扫描

function smooth01(e0: number, e1: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

const TWO_PI = Math.PI * 2;
// 血腥之地:大陆上一处局部圆区(非楔形扇区),中心鼓包 + 入口洞穴凿下地底
const CRIMSON_RADIUS = 42;
const CRIMSON_MOUND_R = 30;

/** 两方位角的最小夹角 */
function angDist(a: number, b: number): number {
  const d = Math.abs(a - b) % TWO_PI;
  return d > Math.PI ? TWO_PI - d : d;
}
/** 点到 3D 线段的距离 */
function distToSeg(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const ab2 = abx * abx + aby * aby + abz * abz;
  let t = ab2 > 0 ? ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / ab2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t), pz - (az + abz * t));
}

export class Generator {
  readonly seed: number;
  private readonly hills: Noise2D;
  private readonly mountains: Noise2D;
  private readonly coast: Noise2D;
  private readonly cave1: Noise3D;
  private readonly cave2: Noise3D;
  private readonly cheese: Noise3D;
  private readonly hellN: Noise2D;
  private readonly biomeN: Noise2D;
  private readonly chasmN: Noise2D;

  constructor(seed: number) {
    this.seed = seed;
    this.hills = new Noise2D(seed);
    this.mountains = new Noise2D(seed ^ 0x5bd1e995);
    this.coast = new Noise2D(seed ^ 0x27d4eb2f);
    this.cave1 = new Noise3D(seed ^ 0x11ca5e);
    this.cave2 = new Noise3D(seed ^ 0x77ca5e);
    this.cheese = new Noise3D(seed ^ 0x33ca5e);
    this.hellN = new Noise2D(seed ^ 0x66e11);
    this.biomeN = new Noise2D(seed ^ 0xb10e);
    this.chasmN = new Noise2D(seed ^ 0xc4a5);
    // 三条河的方位角(确定性),从山脉外坡流向海
    this.riverAngles = [0, 1, 2].map(
      (i) => hash2(i * 17 + 3, i * 31 + 7, seed ^ 0x11e4) * Math.PI * 2,
    );
    // 血腥之地中心(局部圆区,避开地牢/河流);先定中心再算鼓包后的地表高度
    this.crimsonCenter = this.pickCrimsonCenter();
    this.crimsonReady = true; // 之后 heightAt 才叠加中心鼓包
    this.crimsonSurf = this.heightAt(this.crimsonCenter.x, this.crimsonCenter.z);
    // 地标(世界树/天空岛/地牢/地狱遗迹)选址依赖上面的地形函数,最后构造
    this.structures = new Structures(this);
  }

  /** 血腥之地中心与其鼓包顶的地表高度(入口洞穴由此凿下) */
  readonly crimsonCenter: { x: number; z: number };
  private crimsonSurf = 0;
  private crimsonReady = false;

  /** 选一处血腥之地圆心:避开地牢方位(≈5.15 rad)、河流,且落在陆地 */
  private pickCrimsonCenter(): { x: number; z: number } {
    const DUN_LO = 4.4;
    const DUN_HI = 5.9;
    for (let k = 0; k < 48; k++) {
      const a = hash2(k * 13 + 1, k * 7 + 5, this.seed ^ 0xc21a5) * TWO_PI;
      if (a > DUN_LO && a < DUN_HI) continue; // 避地牢
      if (this.riverAngles.some((ra) => angDist(a, ra) < 0.55)) continue; // 避河
      for (let d = 258; d <= 330; d += 8) {
        const x = Math.round(Math.cos(a) * d);
        const z = Math.round(Math.sin(a) * d);
        if (this.heightAt(x, z) < SEA_LEVEL + 5) continue;
        let land = true;
        for (const [ox, oz] of [[38, 0], [-38, 0], [0, 38], [0, -38]]) {
          if (this.heightAt(x + ox, z + oz) < SEA_LEVEL + 2) {
            land = false;
            break;
          }
        }
        if (land) return { x, z };
      }
    }
    return { x: Math.round(Math.cos(2.5) * 290), z: Math.round(Math.sin(2.5) * 290) };
  }

  /** 地标结构(Phase 4):区块生成时盖章,宝箱战利品查询 */
  readonly structures: Structures;

  private readonly riverAngles: number[];

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

    // 内陆:平缓丘陵 + 环形山脉带(以海平面为基准)
    const base = SEA_LEVEL + 3 + this.hills.fbm(x * 0.012, z * 0.012, 4) * 7;
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

    let h = seabed * (1 - land) + landH * land;
    // 河流:河道压到海平面下,两岸谷坡平滑过渡
    const rd = this.riverDist(x, z);
    if (rd < 20) {
      const bed = SEA_LEVEL - 2.5;
      if (rd < 6) h = Math.min(h, bed);
      else h = Math.min(h, bed + ((rd - 6) / 14) * Math.max(6, (h - bed) * 0.7));
    }
    // 血腥之地:中心一处圆丘鼓包(入口洞穴自鼓包顶凿下)
    if (this.crimsonReady) {
      const cr = Math.hypot(x - this.crimsonCenter.x, z - this.crimsonCenter.z);
      if (cr < CRIMSON_MOUND_R) {
        const t = 1 - cr / CRIMSON_MOUND_R;
        h += t * t * 11;
      }
    }
    return Math.max(LAYER_HELL_TOP + 4, Math.min(WH - 40, Math.floor(h)));
  }

  /**
   * 群系按方位分区(泰拉式"位置决定群系"):
   * 出生盆地与环山恒为森林;环山之外按方位角划出丛林与腐化之地。
   */
  biomeAt(x: number, z: number): 'forest' | 'jungle' | 'corruption' | 'crimson' {
    const d = Math.hypot(x, z);
    if (d < 225) return 'forest'; // 出生盆地与山脉(群系从山外坡开始)
    // 血腥之地:大陆上一处局部圆区(边缘噪声扰动),而非楔形扇区——不再侵占地牢/河流
    const cc = this.crimsonCenter;
    const cd = Math.hypot(x - cc.x, z - cc.z) + this.biomeN.fbm(x * 0.03, z * 0.03, 2) * 7;
    if (cd < CRIMSON_RADIUS) return 'crimson';
    let a = Math.atan2(z, x); // -π..π
    a += this.biomeN.fbm(x * 0.006, z * 0.006, 2) * 0.35; // 边界扰动
    if (a < 0) a += Math.PI * 2;
    if (a > 0.5 && a < 1.9) return 'jungle';
    if (a > 3.1 && a < 4.3) return 'corruption';
    return 'forest';
  }

  /** 到最近河道中心的横向距离(河从山脉流向海,径向蜿蜒) */
  private riverDist(x: number, z: number): number {
    const d = Math.hypot(x, z);
    if (d < 215 || d > CONTINENT_RADIUS + 80) return 999;
    let a = Math.atan2(z, x);
    if (a < 0) a += Math.PI * 2;
    let best = 999;
    for (const ra of this.riverAngles) {
      // 河心线随径向距离蜿蜒
      const meander = this.coast.fbm(Math.cos(ra) * 7.7 + d * 0.012, Math.sin(ra) * 7.7, 2) * 0.14;
      let da = Math.abs(a - (ra + meander));
      if (da > Math.PI) da = Math.PI * 2 - da;
      best = Math.min(best, da * d); // 弧长≈横向距离
    }
    return best;
  }

  /** 腐化深谷:腐化区内蜿蜒裂缝,从地表直插洞穴层(血腥地改用入口洞穴,不再有裂缝) */
  chasmAt(x: number, z: number): boolean {
    if (this.biomeAt(x, z) !== 'corruption') return false;
    const d = Math.hypot(x, z);
    if (d < 250 || d > CONTINENT_RADIUS - 60) return false;
    return Math.abs(this.chasmN.fbm(x * 0.012, z * 0.012, 2)) < 0.035;
  }

  /**
   * 血腥入口洞穴:鼓包顶凿下的椭圆竖井 → 底部主腔 → 五条手指状分支
   * (泰拉血腥地"恶魔手掌",examples/1,2)。pad 扩张半径用于生成血肉石洞壁。
   */
  crimsonCarve(x: number, y: number, z: number, pad = 0): boolean {
    const cc = this.crimsonCenter;
    const dx0 = x - cc.x;
    const dz0 = z - cc.z;
    if (dx0 * dx0 + dz0 * dz0 > 36 * 36) return false;
    const surf = this.crimsonSurf;
    // 入口竖井:自鼓包顶向下蜿蜒,椭圆开口
    const topY = surf + 2;
    const botY = surf - 30;
    if (y <= topY && y >= botY) {
      const t = (topY - y) / (topY - botY);
      const mx = cc.x + Math.sin(t * 3.4) * 5.5;
      const mz = cc.z + Math.cos(t * 2.3) * 4.5;
      const r = 5.6 - t * 1.2 + pad;
      if ((x - mx) ** 2 + (z - mz) ** 2 < r * r) return true;
    }
    // 底部主腔(椭球)
    const chx = cc.x;
    const chy = surf - 35;
    const chz = cc.z;
    if (
      ((x - chx) / (11 + pad)) ** 2 + ((y - chy) / (8 + pad)) ** 2 + ((z - chz) / (11 + pad)) ** 2 <
      1
    ) {
      return true;
    }
    // 五条手指分支:主腔向外下方伸出(恶魔手掌)
    for (let f = 0; f < 5; f++) {
      const a = (f / 5) * TWO_PI + 0.4;
      const ex = chx + Math.cos(a) * 21;
      const ez = chz + Math.sin(a) * 21;
      if (distToSeg(x, y, z, chx, chy, chz, ex, chy - 7, ez) < 3.3 + pad) return true;
    }
    return false;
  }

  hasTree(x: number, z: number): boolean {
    const t = hash2(x, z, this.seed ^ 0x51ab3);
    const b = this.biomeAt(x, z);
    if (b === 'jungle') return t < 0.03; // 丛林茂密
    if (b === 'corruption' || b === 'crimson') return t < 0.005; // 邪恶群系稀疏枯树
    return t < 0.007;
  }

  /** 石头层中按深度概率撒矿石(洞穴层越深越出好矿) */
  oreAt(x: number, y: number, z: number): number {
    const r = hash3(x, y, z, this.seed ^ 0x0135a);
    if (y <= 52 && r < 0.0024) return Block.DiamondOre;
    if (y <= 76 && r < 0.006) return Block.GoldOre;
    if (y <= 112 && r < 0.014) return Block.IronOre;
    if (r < 0.026) return Block.CoalOre;
    return Block.Stone;
  }

  /** 洞穴挖凿:细长通道(双 3D 噪声脊交集)+ 大洞腔(cheese),洞穴层更宽 */
  caveAt(x: number, y: number, z: number, surface: number): boolean {
    if (y <= LAYER_HELL_TOP || y > surface - 3) return false;
    const t1 = this.cave1.fbm2(x * 0.028, y * 0.045, z * 0.028);
    const t2 = this.cave2.fbm2(x * 0.028, y * 0.045, z * 0.028);
    // 通道宽度:洞穴层(y<100)最宽,向上收窄
    const w = y < 100 ? 0.13 : 0.08;
    if (Math.abs(t1) < w && Math.abs(t2) < w) return true;
    // 大洞腔只出现在洞穴层
    if (y < 100 && this.cheese.fbm2(x * 0.014, y * 0.026, z * 0.014) > 0.33) return true;
    return false;
  }

  /** 地狱:地面/穹顶高度(带起伏,部分灰烬岸露出岩浆海) */
  hellFloor(x: number, z: number): number {
    return Math.round(7 + this.hellN.fbm(x * 0.03, z * 0.03, 2) * 5.5);
  }

  hellCeil(x: number, z: number): number {
    return Math.round(20 + this.hellN.fbm(x * 0.026 + 53.7, z * 0.026 - 21.3, 2) * 3.2);
  }

  /**
   * 南瓜聚落:仅约 10% 的 40×40 粗格是南瓜地,格内绕确定性中心成簇
   * (近心密、边缘疏)——告别此前满地均匀撒点,南瓜只在少数小片区扎堆。
   */
  hasPumpkin(x: number, z: number): boolean {
    const PATCH = 40;
    const cx = Math.floor(x / PATCH);
    const cz = Math.floor(z / PATCH);
    if (hash2(cx, cz, this.seed ^ 0x50f1) >= 0.1) return false;
    const px = cx * PATCH + hash2(cx, cz, this.seed ^ 0x1a2b) * PATCH;
    const pz = cz * PATCH + hash2(cz, cx, this.seed ^ 0x3c4d) * PATCH;
    const d = Math.hypot(x - px, z - pz);
    const R = 7;
    if (d > R) return false;
    return hash2(x, z, this.seed ^ 0x7a111) < 0.45 * (1 - d / R);
  }

  /**
   * 依环境生长的地表植被(十字面片装饰),返回植被方块 id 或 0(不长)。
   * 森林:青草常见 + 野花点缀;丛林:蕨类繁茂;腐化之地:稀疏荆棘。
   */
  private plantAt(
    x: number,
    z: number,
    biome: 'forest' | 'jungle' | 'corruption' | 'crimson',
  ): number {
    const r = hash2(x, z, this.seed ^ 0x9b7d);
    if (biome === 'jungle') return r < 0.22 ? Block.JungleFern : 0;
    if (biome === 'corruption') return r < 0.08 ? Block.CorruptThorn : 0;
    if (biome === 'crimson') return r < 0.08 ? Block.CrimsonVine : 0;
    if (r < 0.02) return Block.Flower;
    if (r < 0.16) return Block.TallGrass;
    return 0;
  }

  private treeHeight(x: number, z: number): number {
    return 4 + Math.floor(hash2(x, z, this.seed ^ 0x9e37) * 3);
  }

  generateChunk(cx: number, cz: number): Uint8Array {
    const data = new Uint8Array(CS * CS * WH);
    const ox = cx * CS;
    const oz = cz * CS;
    // 本区块是否临近血腥入口洞穴(是则逐格参与凿刻,否则完全跳过)
    const cc = this.crimsonCenter;
    const nearCrimson = Math.hypot(ox + CS / 2 - cc.x, oz + CS / 2 - cc.z) < 44 + CS;

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
        const biome = this.biomeAt(wx, wz);
        const chasm = this.chasmAt(wx, wz);
        const hf = this.hellFloor(wx, wz);
        const hc = this.hellCeil(wx, wz);
        for (let y = 0; y <= h; y++) {
          let id: number;
          if (y === 0) id = Block.Bedrock;
          else if (y < LAYER_HELL_TOP) {
            // 地狱层:灰烬地面 + 熔洞(岩浆海)+ 石顶板,地狱石矿脉
            if (y <= hf) {
              const r = hash3(wx, y, wz, this.seed ^ 0x4e11);
              id = y >= hf - 1 ? Block.Ash : r < 0.06 ? Block.Hellstone : Block.Stone;
            } else if (y < hc) {
              id = y <= LAVA_LEVEL ? Block.Lava : Block.Air;
            } else {
              const r = hash3(wx, y, wz, this.seed ^ 0x4e11);
              id = r < 0.05 ? Block.Hellstone : Block.Stone;
            }
          } else if (chasm && y > 56) {
            id = Block.Air; // 腐化深谷:从地表直插洞穴层
          } else if (this.caveAt(wx, y, wz, h)) {
            id = Block.Air;
          } else if (y < h - 3) {
            id = this.oreAt(wx, y, wz);
            // 邪恶群系浅层石头换邪石:腐化→黑檀石,血腥→猩红石
            if (id === Block.Stone && y > h - 14) {
              if (biome === 'corruption') id = Block.EbonStone;
              else if (biome === 'crimson') id = Block.Crimstone;
            }
          } else if (y < h) id = sandy ? Block.Sand : Block.Dirt;
          else if (sandy) id = Block.Sand;
          else if (snowy) id = Block.Snow;
          else if (biome === 'jungle') id = Block.JungleGrass;
          else if (biome === 'corruption') id = Block.CorruptGrass;
          else if (biome === 'crimson') id = Block.CrimsonGrass;
          else id = Block.Grass;
          // 血腥入口洞穴:凿空竖井/主腔/手指分支,洞壁镶血肉石(examples/1,2)
          if (nearCrimson && id !== Block.Bedrock) {
            if (this.crimsonCarve(wx, y, wz, 0)) id = Block.Air;
            else if (id !== Block.Air && this.crimsonCarve(wx, y, wz, 1.8)) id = Block.Crimstone;
          }
          data[idx(lx, y, lz)] = id;
        }
        for (let y = h + 1; y <= SEA_LEVEL; y++) {
          data[idx(lx, y, lz)] = Block.Water;
        }
        // 地表装饰(避开沙滩/雪线/深谷/树/地标):南瓜聚落优先,否则依环境长植被
        if (!sandy && !snowy && !chasm && h > SEA_LEVEL + 1 && !this.hasTree(wx, wz) && !this.structures.suppressSurfaceAt(wx, wz)) {
          if (this.hasPumpkin(wx, wz)) {
            const face = [Block.Pumpkin, Block.PumpkinE, Block.PumpkinN, Block.PumpkinW];
            data[idx(lx, h + 1, lz)] = face[(hash2(wx, wz, this.seed ^ 0x9c1a) * 4) | 0];
          } else {
            const plant = this.plantAt(wx, wz, biome);
            if (plant) data[idx(lx, h + 1, lz)] = plant;
          }
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
        if (this.chasmAt(wx, wz)) continue; // 深谷口不长树
        if (this.structures.suppressSurfaceAt(wx, wz)) continue; // 地标脚下不长树

        const treeBiome = this.biomeAt(wx, wz);
        // 丛林树更高大;腐化树紫叶;血腥树红叶
        const leafId =
          treeBiome === 'jungle'
            ? Block.JungleLeaves
            : treeBiome === 'corruption'
              ? Block.CorruptLeaves
              : treeBiome === 'crimson'
                ? Block.CrimsonLeaves
                : Block.Leaves;
        const extra = treeBiome === 'jungle' ? 3 : treeBiome === 'corruption' ? 0 : 0;
        const ht = this.treeHeight(wx, wz) + extra;
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
              setIfSoft(tx + oxl, ly, tz + ozl, leafId);
            }
          }
        }
        for (let y = h + 1; y <= topY; y++) {
          set(tx, y, tz, Block.Log);
        }
      }
    }

    // 地标盖章(世界树/天空岛/地牢/地狱遗迹):覆盖地形与树木
    this.structures.stampChunk(
      ox,
      oz,
      (x, y, z, id) => set(x - ox, y, z - oz, id),
      (x, y, z, id) => setIfSoft(x - ox, y, z - oz, id),
    );

    return data;
  }

  /** 从原点向外找一个适合出生的草地柱(避开世界树根系、树木与陡坡) */
  findSpawn(): { x: number; y: number; z: number } {
    for (let r = 22; r < 64; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (Math.hypot(dx, dz) < 22) continue; // 世界树立于原点,根系外出生
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
