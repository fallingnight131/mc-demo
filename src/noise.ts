// 确定性噪声与哈希工具(不依赖 DOM,可在 node 测试中运行)

/** 经典 mulberry32 伪随机数生成器 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 整数坐标二维哈希,返回 [0, 1) */
export function hash2(x: number, y: number, seed: number): number {
  let h = seed >>> 0;
  h = Math.imul(h ^ Math.imul(x | 0, 0x27d4eb2d), 0x165667b1);
  h = Math.imul(h ^ Math.imul(y | 0, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 整数坐标三维哈希,返回 [0, 1) */
export function hash3(x: number, y: number, z: number, seed: number): number {
  let h = seed >>> 0;
  h = Math.imul(h ^ Math.imul(x | 0, 0x27d4eb2d), 0x165667b1);
  h = Math.imul(h ^ Math.imul(y | 0, 0x9e3779b1), 0x85ebca6b);
  h = Math.imul(h ^ Math.imul(z | 0, 0x94d049bb), 0x2545f491);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 二维值噪声 + fbm 分形叠加,输出约 [-1, 1] */
export class Noise2D {
  constructor(private readonly seed: number) {}

  private corner(ix: number, iy: number): number {
    return hash2(ix, iy, this.seed);
  }

  at(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    // 五次平滑插值
    const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const a = this.corner(ix, iy);
    const b = this.corner(ix + 1, iy);
    const c = this.corner(ix, iy + 1);
    const d = this.corner(ix + 1, iy + 1);
    const v = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    return v * 2 - 1;
  }

  fbm(x: number, y: number, octaves: number, lacunarity = 2, gain = 0.5): number {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      // 每个倍频附加偏移,避免栅格对齐伪影
      sum += this.at(x * freq + i * 137.31, y * freq + i * 71.17) * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
}

/** 三维值噪声 + fbm(洞穴挖凿用) */
export class Noise3D {
  constructor(private readonly seed: number) {}

  private corner(ix: number, iy: number, iz: number): number {
    return hash3(ix, iy, iz, this.seed);
  }

  at(x: number, y: number, z: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fy = y - iy;
    const fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const sz = fz * fz * (3 - 2 * fz);
    const c000 = this.corner(ix, iy, iz);
    const c100 = this.corner(ix + 1, iy, iz);
    const c010 = this.corner(ix, iy + 1, iz);
    const c110 = this.corner(ix + 1, iy + 1, iz);
    const c001 = this.corner(ix, iy, iz + 1);
    const c101 = this.corner(ix + 1, iy, iz + 1);
    const c011 = this.corner(ix, iy + 1, iz + 1);
    const c111 = this.corner(ix + 1, iy + 1, iz + 1);
    const x00 = c000 + (c100 - c000) * sx;
    const x10 = c010 + (c110 - c010) * sx;
    const x01 = c001 + (c101 - c001) * sx;
    const x11 = c011 + (c111 - c011) * sx;
    const y0 = x00 + (x10 - x00) * sy;
    const y1 = x01 + (x11 - x01) * sy;
    return (y0 + (y1 - y0) * sz) * 2 - 1;
  }

  fbm2(x: number, y: number, z: number): number {
    return (this.at(x, y, z) + this.at(x * 2 + 31.7, y * 2 + 11.3, z * 2 + 71.9) * 0.5) / 1.5;
  }
}
