// 程序化像素纹理:运行时用 Canvas 生成 16x16 纹理图集与物品图标
import * as THREE from 'three';
import { ATLAS_COLS, ATLAS_ROWS, BLOCK_DEFS, Tile, TILE_PX } from './blocks';
import { mulberry32 } from './noise';

const TS = TILE_PX;

type Painter = (img: ImageData, rng: () => number) => void;

function px(img: ImageData, x: number, y: number, r: number, g: number, b: number, a = 255): void {
  const i = (y * TS + x) * 4;
  img.data[i] = r;
  img.data[i + 1] = g;
  img.data[i + 2] = b;
  img.data[i + 3] = a;
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

/** 基础底色 + 每像素随机抖动 */
function noiseFill(
  img: ImageData,
  rng: () => number,
  base: [number, number, number],
  variance: number,
): void {
  for (let y = 0; y < TS; y++) {
    for (let x = 0; x < TS; x++) {
      const v = (rng() * 2 - 1) * variance;
      px(img, x, y, clamp255(base[0] + v), clamp255(base[1] + v), clamp255(base[2] + v));
    }
  }
}

const painters: Record<number, Painter> = {
  [Tile.GrassTop]: (img, rng) => {
    noiseFill(img, rng, [106, 170, 64], 14);
    for (let i = 0; i < 14; i++) {
      px(img, (rng() * TS) | 0, (rng() * TS) | 0, 88, 148, 52);
    }
  },
  [Tile.GrassSide]: (img, rng) => {
    noiseFill(img, rng, [134, 96, 67], 10);
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < TS; x++) {
        const v = (rng() * 2 - 1) * 12;
        px(img, x, y, clamp255(100 + v), clamp255(160 + v), clamp255(60 + v));
      }
    }
    for (let x = 0; x < TS; x++) {
      if (rng() < 0.55) px(img, x, 3, 100, 160, 60);
    }
  },
  [Tile.Dirt]: (img, rng) => {
    noiseFill(img, rng, [134, 96, 67], 12);
    for (let i = 0; i < 8; i++) {
      px(img, (rng() * TS) | 0, (rng() * TS) | 0, 105, 74, 50);
    }
  },
  [Tile.Stone]: (img, rng) => {
    noiseFill(img, rng, [127, 127, 127], 7);
    for (let i = 0; i < 6; i++) {
      const sx = (rng() * TS) | 0;
      const sy = (rng() * TS) | 0;
      const lenRun = 2 + ((rng() * 4) | 0);
      for (let k = 0; k < lenRun; k++) {
        const xx = (sx + k) % TS;
        px(img, xx, sy, 108, 108, 108);
      }
    }
  },
  [Tile.Sand]: (img, rng) => {
    noiseFill(img, rng, [219, 207, 163], 9);
    for (let i = 0; i < 10; i++) {
      px(img, (rng() * TS) | 0, (rng() * TS) | 0, 196, 182, 138);
    }
  },
  [Tile.LogSide]: (img, rng) => {
    for (let x = 0; x < TS; x++) {
      const dark = x % 4 === 0;
      for (let y = 0; y < TS; y++) {
        const v = (rng() * 2 - 1) * 7;
        const base: [number, number, number] = dark ? [82, 64, 38] : [104, 82, 50];
        px(img, x, y, clamp255(base[0] + v), clamp255(base[1] + v), clamp255(base[2] + v));
      }
    }
    for (let i = 0; i < 5; i++) {
      px(img, (rng() * TS) | 0, (rng() * TS) | 0, 70, 54, 32);
    }
  },
  [Tile.LogTop]: (img, rng) => {
    for (let y = 0; y < TS; y++) {
      for (let x = 0; x < TS; x++) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        let base: [number, number, number];
        if (d > 6.5) base = [90, 70, 42];
        else base = Math.floor(d) % 2 === 0 ? [152, 122, 76] : [118, 92, 56];
        const v = (rng() * 2 - 1) * 6;
        px(img, x, y, clamp255(base[0] + v), clamp255(base[1] + v), clamp255(base[2] + v));
      }
    }
  },
  [Tile.Leaves]: (img, rng) => {
    noiseFill(img, rng, [58, 124, 40], 18);
    for (let i = 0; i < 12; i++) {
      px(img, (rng() * TS) | 0, (rng() * TS) | 0, 38, 90, 28);
    }
  },
  [Tile.Plank]: (img, rng) => {
    for (let y = 0; y < TS; y++) {
      const seam = y % 4 === 3;
      for (let x = 0; x < TS; x++) {
        const v = (rng() * 2 - 1) * 8;
        const vSeam = (y >> 2) % 2 === 0 ? x === 11 : x === 3;
        const base: [number, number, number] = seam || vSeam ? [104, 80, 48] : [172, 138, 86];
        px(img, x, y, clamp255(base[0] + v), clamp255(base[1] + v), clamp255(base[2] + v));
      }
    }
  },
  [Tile.Cobble]: (img, rng) => {
    // 简化 Voronoi:按最近种子点着色,边界压暗
    const pts: Array<[number, number, number]> = [];
    for (let i = 0; i < 7; i++) {
      pts.push([rng() * TS, rng() * TS, 100 + rng() * 55]);
    }
    for (let y = 0; y < TS; y++) {
      for (let x = 0; x < TS; x++) {
        let d1 = Infinity;
        let d2 = Infinity;
        let shade = 120;
        for (const [pxx, pyy, s] of pts) {
          // 在环面上取最近距离,纹理可平铺
          const ddx = Math.min(Math.abs(x - pxx), TS - Math.abs(x - pxx));
          const ddy = Math.min(Math.abs(y - pyy), TS - Math.abs(y - pyy));
          const d = ddx * ddx + ddy * ddy;
          if (d < d1) {
            d2 = d1;
            d1 = d;
            shade = s;
          } else if (d < d2) {
            d2 = d;
          }
        }
        const edge = Math.sqrt(d2) - Math.sqrt(d1) < 1.1;
        const v = (rng() * 2 - 1) * 6;
        const g = edge ? 72 : shade;
        px(img, x, y, clamp255(g + v), clamp255(g + v), clamp255(g + v));
      }
    }
  },
  [Tile.Bedrock]: (img, rng) => {
    noiseFill(img, rng, [70, 70, 70], 28);
  },
  [Tile.Water]: (img, rng) => {
    noiseFill(img, rng, [50, 98, 190], 8);
    for (let y = 0; y < TS; y += 4) {
      for (let x = 0; x < TS; x++) {
        if (rng() < 0.4) px(img, x, y, 72, 120, 208);
      }
    }
  },
  [Tile.Snow]: (img, rng) => {
    noiseFill(img, rng, [242, 248, 252], 5);
  },
  [Tile.SnowSide]: (img, rng) => {
    noiseFill(img, rng, [134, 96, 67], 10);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < TS; x++) {
        const v = (rng() * 2 - 1) * 5;
        px(img, x, y, clamp255(242 + v), clamp255(248 + v), clamp255(252 + v));
      }
    }
    for (let x = 0; x < TS; x++) {
      if (rng() < 0.5) px(img, x, 4, 240, 246, 250);
    }
  },
  [Tile.Glass]: (img, rng) => {
    for (let y = 0; y < TS; y++) {
      for (let x = 0; x < TS; x++) {
        px(img, x, y, 0, 0, 0, 0);
      }
    }
    for (let i = 0; i < TS; i++) {
      px(img, i, 0, 205, 230, 248);
      px(img, i, TS - 1, 205, 230, 248);
      px(img, 0, i, 205, 230, 248);
      px(img, TS - 1, i, 205, 230, 248);
    }
    // 对角高光
    for (let i = 2; i < 7; i++) {
      px(img, i, 9 - i, 235, 246, 255);
      px(img, i + 1, 9 - i, 235, 246, 255);
    }
    void rng;
  },
};

export interface GameTextures {
  atlas: THREE.CanvasTexture;
  atlasCanvas: HTMLCanvasElement;
  iconFor(blockId: number): HTMLCanvasElement;
}

export function buildTextures(): GameTextures {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * TS;
  canvas.height = ATLAS_ROWS * TS;
  const ctx = canvas.getContext('2d')!;

  for (const [tileStr, paint] of Object.entries(painters)) {
    const tile = Number(tileStr);
    const img = ctx.createImageData(TS, TS);
    paint(img, mulberry32(tile * 7919 + 17));
    ctx.putImageData(img, (tile % ATLAS_COLS) * TS, Math.floor(tile / ATLAS_COLS) * TS);
  }

  const atlas = new THREE.CanvasTexture(canvas);
  atlas.magFilter = THREE.NearestFilter;
  atlas.minFilter = THREE.NearestFilter;
  atlas.generateMipmaps = false;
  atlas.colorSpace = THREE.SRGBColorSpace;

  const iconCache = new Map<number, HTMLCanvasElement>();
  const iconFor = (blockId: number): HTMLCanvasElement => {
    const cached = iconCache.get(blockId);
    if (cached) return cached;

    const icon = document.createElement('canvas');
    icon.width = 48;
    icon.height = 48;
    const ic = icon.getContext('2d')!;
    ic.imageSmoothingEnabled = false;

    const tiles = BLOCK_DEFS[blockId].tiles!;
    const topTile = tiles[2];
    const sideTile = tiles[4];
    const src = (t: number) => ({
      sx: (t % ATLAS_COLS) * TS,
      sy: Math.floor(t / ATLAS_COLS) * TS,
    });

    // 等距小立方体:顶面 + 左右两个侧面
    const top = src(topTile);
    ic.setTransform(16, 8, -16, 8, 24, 8);
    ic.drawImage(canvas, top.sx, top.sy, TS, TS, 0, 0, 1, 1);

    const side = src(sideTile);
    ic.setTransform(16, 8, 0, 14, 8, 16);
    ic.drawImage(canvas, side.sx, side.sy, TS, TS, 0, 0, 1, 1);
    ic.fillStyle = 'rgba(0,0,0,0.28)';
    ic.fillRect(0, 0, 1, 1);

    ic.setTransform(16, -8, 0, 14, 24, 24);
    ic.drawImage(canvas, side.sx, side.sy, TS, TS, 0, 0, 1, 1);
    ic.fillStyle = 'rgba(0,0,0,0.42)';
    ic.fillRect(0, 0, 1, 1);

    ic.setTransform(1, 0, 0, 1, 0, 0);
    iconCache.set(blockId, icon);
    return icon;
  };

  return { atlas, atlasCanvas: canvas, iconFor };
}

/** 云层纹理:阈值化噪声生成的白色斑块 */
export function buildCloudTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const rng = mulberry32(424242);
  // 简单分形:几层方块状随机叠加后阈值化
  const grid = 8;
  const cells: number[] = [];
  for (let i = 0; i < grid * grid; i++) cells.push(rng());
  const cellAt = (cxx: number, cyy: number) =>
    cells[((cyy + grid) % grid) * grid + ((cxx + grid) % grid)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = (x / size) * grid;
      const gy = (y / size) * grid;
      const ix = Math.floor(gx);
      const iy = Math.floor(gy);
      const fx = gx - ix;
      const fy = gy - iy;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const a = cellAt(ix, iy);
      const b = cellAt(ix + 1, iy);
      const c = cellAt(ix, iy + 1);
      const d = cellAt(ix + 1, iy + 1);
      const v = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
      const i4 = (y * size + x) * 4;
      img.data[i4] = 255;
      img.data[i4 + 1] = 255;
      img.data[i4 + 2] = 255;
      img.data[i4 + 3] = v > 0.62 ? 215 : 0;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}
