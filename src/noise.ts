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
