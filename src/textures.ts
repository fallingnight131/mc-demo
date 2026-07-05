// 程序化像素纹理:运行时用 Canvas 生成 16x16 纹理图集与物品图标
import * as THREE from 'three';
import { ATLAS_COLS, ATLAS_ROWS, BLOCK_DEFS, Tile, TILE_PX } from './blocks';
import { mulberry32 } from './noise';
import { Tool } from './tools';

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
  [Tile.TntSide]: (img, rng) => {
    noiseFill(img, rng, [200, 46, 32], 10);
    // 中部白带
    for (let y = 5; y <= 10; y++) {
      for (let x = 0; x < TS; x++) {
        const v = (rng() * 2 - 1) * 6;
        px(img, x, y, clamp255(226 + v), clamp255(222 + v), clamp255(208 + v));
      }
    }
    // 像素字 "TNT"(T 为 3 宽,N 为 4 宽带斜线)
    const glyphT = [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2], [1, 3]];
    const glyphN = [
      [0, 0], [0, 1], [0, 2], [0, 3],
      [1, 1], [2, 2],
      [3, 0], [3, 1], [3, 2], [3, 3],
    ];
    const draw = (glyph: number[][], ox: number) => {
      for (const [gx, gy] of glyph) px(img, ox + gx, 6 + gy, 36, 28, 26);
    };
    draw(glyphT, 2);
    draw(glyphN, 6);
    draw(glyphT, 11);
  },
  [Tile.TntTop]: (img, rng) => {
    noiseFill(img, rng, [196, 60, 40], 10);
    // 中心引信块
    for (let y = 5; y <= 10; y++) {
      for (let x = 5; x <= 10; x++) {
        const v = (rng() * 2 - 1) * 8;
        px(img, x, y, clamp255(120 + v), clamp255(34 + v), clamp255(24 + v));
      }
    }
  },
  [Tile.TntBottom]: (img, rng) => {
    noiseFill(img, rng, [130, 32, 24], 12);
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
  [Tile.Sandstone]: (img, rng) => {
    // 水平层理的砂岩
    for (let y = 0; y < TS; y++) {
      const band = Math.floor(y / 4) % 2 === 0 ? 0 : -14;
      for (let x = 0; x < TS; x++) {
        const v = (rng() * 2 - 1) * 7;
        px(img, x, y, clamp255(216 + band + v), clamp255(202 + band + v), clamp255(152 + band + v));
      }
    }
    for (let x = 0; x < TS; x++) {
      if (rng() < 0.4) px(img, x, 0, 188, 174, 128);
      if (rng() < 0.4) px(img, x, TS - 1, 188, 174, 128);
    }
  },
  [Tile.Brick]: (img, rng) => {
    // 红砖 + 灰浆缝(4 行砖,错缝)
    for (let y = 0; y < TS; y++) {
      const row = y >> 2;
      const mortarRow = y % 4 === 3;
      for (let x = 0; x < TS; x++) {
        const seam = row % 2 === 0 ? (x + 4) % 8 === 7 : x % 8 === 7;
        const v = (rng() * 2 - 1) * 9;
        if (mortarRow || seam) {
          px(img, x, y, clamp255(172 + v), clamp255(166 + v), clamp255(158 + v));
        } else {
          px(img, x, y, clamp255(150 + v), clamp255(62 + v), clamp255(48 + v));
        }
      }
    }
  },
  [Tile.StoneBrick]: (img, rng) => {
    // 2×2 大块石砖,深色凹缝
    for (let y = 0; y < TS; y++) {
      for (let x = 0; x < TS; x++) {
        const seam = x % 8 === 7 || y % 8 === 7 || x === 0 || y === 0;
        const v = (rng() * 2 - 1) * 7;
        const g = seam ? 84 : 128;
        px(img, x, y, clamp255(g + v), clamp255(g + v), clamp255(g + v));
      }
    }
  },
  [Tile.CoalOre]: (img, rng) => oreTexture(img, rng, [40, 40, 44]),
  [Tile.IronOre]: (img, rng) => oreTexture(img, rng, [214, 166, 130]),
  [Tile.GoldOre]: (img, rng) => oreTexture(img, rng, [250, 206, 60]),
  [Tile.DiamondOre]: (img, rng) => oreTexture(img, rng, [92, 219, 213]),
  [Tile.Obsidian]: (img, rng) => {
    noiseFill(img, rng, [28, 22, 40], 9);
    for (let i = 0; i < 7; i++) {
      px(img, (rng() * TS) | 0, (rng() * TS) | 0, 74, 56, 112);
    }
    for (let i = 0; i < 3; i++) {
      px(img, (rng() * TS) | 0, (rng() * TS) | 0, 108, 92, 150);
    }
  },
  [Tile.PumpkinSide]: (img, rng) => pumpkinBase(img, rng),
  [Tile.PumpkinTop]: (img, rng) => {
    noiseFill(img, rng, [196, 116, 30], 10);
    // 外圈压暗 + 中心果梗
    for (let i = 0; i < TS; i++) {
      px(img, i, 0, 168, 96, 22);
      px(img, i, TS - 1, 168, 96, 22);
      px(img, 0, i, 168, 96, 22);
      px(img, TS - 1, i, 168, 96, 22);
    }
    for (let y = 6; y <= 9; y++) {
      for (let x = 6; x <= 9; x++) {
        px(img, x, y, 96, 74, 38);
      }
    }
  },
  [Tile.IronBlock]: (img, rng) => metalPaint(img, rng, [212, 212, 216]),
  [Tile.GoldBlock]: (img, rng) => metalPaint(img, rng, [246, 206, 70]),
  [Tile.DiamondBlock]: (img, rng) => metalPaint(img, rng, [108, 222, 214]),
  [Tile.PumpkinFace]: (img, rng) => {
    pumpkinBase(img, rng);
    const dark = (x: number, y: number) => px(img, x, y, 34, 20, 8);
    // 三角眼
    for (const ox of [3, 9]) {
      dark(ox + 1, 4);
      dark(ox, 5);
      dark(ox + 1, 5);
      dark(ox + 2, 5);
    }
    // 锯齿嘴
    for (let x = 3; x <= 12; x++) dark(x, 10);
    dark(4, 9);
    dark(7, 9);
    dark(8, 9);
    dark(11, 9);
    dark(5, 11);
    dark(6, 11);
    dark(9, 11);
    dark(10, 11);
  },
};

/** 石底 + 矿物斑块 */
function oreTexture(img: ImageData, rng: () => number, ore: [number, number, number]): void {
  painters[Tile.Stone](img, rng);
  for (let i = 0; i < 5; i++) {
    const cx = 1 + ((rng() * (TS - 3)) | 0);
    const cy = 1 + ((rng() * (TS - 3)) | 0);
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        if (rng() < 0.82) {
          const v = (rng() * 2 - 1) * 16;
          px(img, cx + dx, cy + dy, clamp255(ore[0] + v), clamp255(ore[1] + v), clamp255(ore[2] + v));
        }
      }
    }
  }
}

/** 金属块:低噪底色 + 左上亮边/右下暗边 + 内框 */
function metalPaint(img: ImageData, rng: () => number, base: [number, number, number]): void {
  noiseFill(img, rng, base, 4);
  const shade = (x: number, y: number, d: number) =>
    px(img, x, y, clamp255(base[0] + d), clamp255(base[1] + d), clamp255(base[2] + d));
  for (let i = 0; i < TS; i++) {
    shade(i, 0, 26);
    shade(0, i, 26);
    shade(i, TS - 1, -34);
    shade(TS - 1, i, -34);
  }
  for (let i = 2; i < TS - 2; i++) {
    shade(i, 2, -14);
    shade(2, i, -14);
    shade(i, TS - 3, 12);
    shade(TS - 3, i, 12);
  }
}

/** 南瓜侧面基底:竖向棱纹 */
function pumpkinBase(img: ImageData, rng: () => number): void {
  for (let x = 0; x < TS; x++) {
    const rib = x % 4 === 0;
    for (let y = 0; y < TS; y++) {
      const v = (rng() * 2 - 1) * 8;
      const base: [number, number, number] = rib ? [182, 102, 24] : [214, 126, 32];
      const edge = y === 0 || y === TS - 1 ? -22 : 0;
      px(img, x, y, clamp255(base[0] + v + edge), clamp255(base[1] + v + edge), clamp255(base[2] + v + edge));
    }
  }
}

export interface GameTextures {
  atlas: THREE.CanvasTexture;
  atlasCanvas: HTMLCanvasElement;
  iconFor(blockId: number): HTMLCanvasElement;
  toolIconFor(toolId: number): HTMLCanvasElement;
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

    // 等距小立方体(标准 2:1:顶菱 32×16、侧高 16、错切 8,总高=宽=32)
    const top = src(topTile);
    ic.setTransform(16, 8, -16, 8, 24, 8);
    ic.drawImage(canvas, top.sx, top.sy, TS, TS, 0, 0, 1, 1);

    const side = src(sideTile);
    ic.setTransform(16, 8, 0, 16, 8, 16);
    ic.drawImage(canvas, side.sx, side.sy, TS, TS, 0, 0, 1, 1);
    ic.fillStyle = 'rgba(0,0,0,0.28)';
    ic.fillRect(0, 0, 1, 1);

    ic.setTransform(16, -8, 0, 16, 24, 24);
    ic.drawImage(canvas, side.sx, side.sy, TS, TS, 0, 0, 1, 1);
    ic.fillStyle = 'rgba(0,0,0,0.42)';
    ic.fillRect(0, 0, 1, 1);

    ic.setTransform(1, 0, 0, 1, 0, 0);
    iconCache.set(blockId, icon);
    return icon;
  };

  const toolIconCache = new Map<number, HTMLCanvasElement>();
  const toolIconFor = (toolId: number): HTMLCanvasElement => {
    const cached = toolIconCache.get(toolId);
    if (cached) return cached;
    const small = document.createElement('canvas');
    small.width = TS;
    small.height = TS;
    const sc = small.getContext('2d')!;
    const img = sc.createImageData(TS, TS);
    paintTool(img, toolId);
    sc.putImageData(img, 0, 0);
    const icon = document.createElement('canvas');
    icon.width = 48;
    icon.height = 48;
    const ic = icon.getContext('2d')!;
    ic.imageSmoothingEnabled = false;
    ic.drawImage(small, 0, 0, 48, 48);
    toolIconCache.set(toolId, icon);
    return icon;
  };

  return { atlas, atlasCanvas: canvas, iconFor, toolIconFor };
}

/** 16px 工具像素画(MC 物品栏风格:透明底、45° 斜向、深色外轮廓) */
function paintTool(img: ImageData, toolId: number): void {
  const P = (x: number, y: number, r: number, g: number, b: number) => px(img, x, y, r, g, b);
  const dots = (pts: Array<[number, number]>, color: [number, number, number]) => {
    for (const [x, y] of pts) P(x, y, color[0], color[1], color[2]);
  };
  if (toolId === Tool.Pickaxe) {
    // 镐子:向右上外凸的弧形月牙镐头(左上尖 + 右下尖,整体沿反对角线倾斜)
    // 搭配同向斜下的木柄——镐头与柄都是斜的,贴近 MC 物品栏真实外形。
    // 镐头深色轮廓(弧带上下缘 + 两端尖)
    dots(
      [
        [3, 1], [8, 1], [9, 1],
        [3, 2], [10, 2], [11, 2],
        [3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [12, 3],
        [7, 4], [8, 4], [9, 4], [12, 4],
        [13, 5],
        [11, 6], [14, 6],
        [11, 7], [14, 7],
        [11, 8], [12, 8], [14, 8],
        [12, 9], [14, 9],
        [12, 10], [13, 10], [14, 10],
      ],
      [50, 53, 60],
    );
    // 镐头高光(受光的上/外侧)
    dots(
      [
        [4, 1], [5, 1], [6, 1], [7, 1],
        [7, 2], [8, 2], [9, 2],
        [9, 3], [10, 3], [11, 3],
        [11, 4],
        [12, 5], [12, 6], [13, 6], [13, 7], [13, 8],
      ],
      [231, 236, 240],
    );
    // 镐头中间调(背光的下/内侧)
    dots(
      [
        [4, 2], [5, 2], [6, 2],
        [8, 3], [10, 4], [11, 5], [12, 7], [13, 9],
      ],
      [170, 177, 186],
    );
    // 木柄深轮廓(斜向左下)
    dots(
      [
        [8, 5], [9, 5], [10, 5], [7, 6], [10, 6], [6, 7], [9, 7], [10, 7],
        [5, 8], [6, 8], [8, 8], [9, 8], [5, 9], [8, 9], [4, 10], [7, 10], [8, 10],
        [3, 11], [6, 11], [7, 11], [2, 12], [3, 12], [5, 12], [6, 12],
        [1, 13], [2, 13], [5, 13], [1, 14], [4, 14], [5, 14], [1, 15], [3, 15], [4, 15],
      ],
      [58, 40, 22],
    );
    // 木柄亮面
    dots(
      [
        [8, 6], [7, 7], [8, 7], [7, 8], [6, 9], [5, 10], [6, 10],
        [4, 11], [5, 11], [4, 12], [3, 13], [2, 14], [3, 14], [2, 15],
      ],
      [152, 106, 60],
    );
    // 木柄暗面
    dots([[9, 6], [7, 9], [4, 13]], [112, 76, 42]);
  } else if (toolId === Tool.Sword) {
    // 铁剑:白灰斜刃 + 灰色护手 + 木柄。
    dots(
      [
        [13, 0], [14, 0], [12, 1], [13, 1], [14, 1], [15, 1],
        [11, 2], [12, 2], [13, 2], [14, 2],
        [10, 3], [11, 3], [12, 3], [13, 3],
        [9, 4], [10, 4], [11, 4], [12, 4],
        [8, 5], [9, 5], [10, 5], [11, 5],
        [7, 6], [8, 6], [9, 6], [10, 6],
        [6, 7], [7, 7], [8, 7], [9, 7],
        [5, 8], [6, 8], [7, 8], [8, 8],
        [4, 9], [5, 9], [6, 9],
        [2, 8], [3, 9], [6, 10], [7, 11],
        [3, 10], [4, 11], [5, 12], [2, 12], [3, 13], [1, 14], [2, 14],
      ],
      [42, 44, 48],
    );
    dots(
      [
        [13, 1], [12, 2], [11, 3], [10, 4], [9, 5], [8, 6], [7, 7], [6, 8],
      ],
      [248, 250, 250],
    );
    dots(
      [
        [14, 1], [13, 2], [12, 3], [11, 4], [10, 5], [9, 6], [8, 7], [7, 8],
      ],
      [202, 208, 214],
    );
    dots(
      [
        [14, 2], [13, 3], [12, 4], [11, 5], [10, 6], [9, 7], [8, 8],
      ],
      [126, 134, 144],
    );
    dots(
      [
        [3, 9], [4, 10], [5, 11], [6, 10], [2, 8],
      ],
      [92, 96, 104],
    );
    dots(
      [
        [4, 12], [3, 13], [2, 14],
      ],
      [116, 80, 46],
    );
  } else {
    // 打火石:深灰燧石 + 银色火镰,带一颗火花
    dots(
      [
        [3, 9], [4, 9], [2, 10], [3, 10], [4, 10],
        [2, 11], [3, 11], [4, 11], [5, 11],
        [1, 12], [2, 12], [3, 12], [4, 12],
        [2, 13], [3, 13],
      ],
      [44, 44, 50],
    );
    dots(
      [
        [4, 10], [5, 11], [3, 12],
      ],
      [112, 112, 120],
    );
    dots(
      [
        [9, 2], [10, 2], [11, 2], [12, 3], [13, 4],
        [13, 5], [13, 6], [12, 7], [11, 8], [10, 9], [9, 9],
        [8, 8], [7, 7], [7, 6], [7, 5], [8, 4],
      ],
      [54, 58, 64],
    );
    dots(
      [
        [10, 3], [11, 3], [12, 4], [12, 5], [12, 6],
        [11, 7], [10, 8], [9, 8], [8, 7], [8, 6], [8, 5], [9, 4],
      ],
      [198, 202, 208],
    );
    dots([[5, 6], [4, 5], [6, 5]], [255, 214, 84]);
    dots([[5, 5]], [255, 246, 154]);
  }
}

/** 独立的水面贴图(与图集分离,便于做 UV 漂移动画) */
export function buildWaterTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = TS;
  canvas.height = TS;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(TS, TS);
  painters[Tile.Water](img, mulberry32(Tile.Water * 7919 + 17));
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** 挖掘裂纹贴图,共 5 个阶段,透明背景叠加在方块表面 */
export function buildCrackTextures(): THREE.CanvasTexture[] {
  const stages: THREE.CanvasTexture[] = [];
  for (let stage = 0; stage < 5; stage++) {
    const canvas = document.createElement('canvas');
    canvas.width = TS;
    canvas.height = TS;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(TS, TS);
    const rng = mulberry32(900 + stage * 31);

    // 从中心向外辐射的折线裂纹,阶段越高线越多越长
    const cracks = 3 + stage * 2;
    for (let i = 0; i < cracks; i++) {
      let x = 5 + rng() * 6;
      let y = 5 + rng() * 6;
      const angle = rng() * Math.PI * 2;
      let dx = Math.cos(angle);
      let dy = Math.sin(angle);
      const len = 4 + stage * 2.4 + rng() * 3;
      for (let s = 0; s < len; s++) {
        const xi = Math.round(x);
        const yi = Math.round(y);
        if (xi >= 0 && xi < TS && yi >= 0 && yi < TS) {
          const a = 150 + rng() * 80;
          px(img, xi, yi, 18, 14, 12, a);
        }
        x += dx;
        y += dy;
        // 折一下
        if (rng() < 0.35) {
          const turn = (rng() - 0.5) * 1.4;
          const nx2 = dx * Math.cos(turn) - dy * Math.sin(turn);
          dy = dx * Math.sin(turn) + dy * Math.cos(turn);
          dx = nx2;
        }
      }
    }
    // 高阶段补一些碎屑点
    for (let i = 0; i < stage * 5; i++) {
      px(img, (rng() * TS) | 0, (rng() * TS) | 0, 18, 14, 12, 140);
    }

    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    stages.push(tex);
  }
  return stages;
}

/** 云层纹理:双尺度值噪声 + 软边阈值,可平铺 */
export function buildCloudTexture(seed = 424242): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const rng = mulberry32(seed);

  // 环面值噪声采样器(保证平铺无缝)
  const makeLayer = (grid: number) => {
    const cells: number[] = [];
    for (let i = 0; i < grid * grid; i++) cells.push(rng());
    return (u: number, v: number) => {
      const gx = u * grid;
      const gy = v * grid;
      const ix = Math.floor(gx);
      const iy = Math.floor(gy);
      const fx = gx - ix;
      const fy = gy - iy;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const at = (xx: number, yy: number) =>
        cells[((yy + grid) % grid) * grid + ((xx + grid) % grid)];
      const a = at(ix, iy);
      const b = at(ix + 1, iy);
      const c = at(ix, iy + 1);
      const d = at(ix + 1, iy + 1);
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };
  };
  const coarse = makeLayer(5);
  const fine = makeLayer(13);
  const smooth = (e0: number, e1: number, v: number) => {
    const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const n = coarse(u, v) * 0.72 + fine(u, v) * 0.28;
      const a = smooth(0.55, 0.7, n) * 225;
      const i4 = (y * size + x) * 4;
      img.data[i4] = 255;
      img.data[i4 + 1] = 255;
      img.data[i4 + 2] = 255;
      img.data[i4 + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/** MC 风格柔边方形太阳 */
export function buildSunTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.filter = 'blur(5px)';
  ctx.fillStyle = 'rgba(255, 244, 200, 0.9)';
  ctx.fillRect(14, 14, 36, 36);
  ctx.filter = 'blur(1.5px)';
  ctx.fillStyle = '#fffdf2';
  ctx.fillRect(21, 21, 22, 22);
  ctx.filter = 'none';
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/** 生物皮肤:身体 / 头 / 脸三张贴图 */
export interface MobSkin {
  body: THREE.CanvasTexture;
  head: THREE.CanvasTexture;
  face: THREE.CanvasTexture;
}

/** 猪/羊/鸡的程序化皮肤(盒子模型用) */
export function buildMobTextures(): { pig: MobSkin; sheep: MobSkin; chicken: MobSkin } {
  const make = (paint: Painter, seed: number): THREE.CanvasTexture => {
    const canvas = document.createElement('canvas');
    canvas.width = TS;
    canvas.height = TS;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(TS, TS);
    paint(img, mulberry32(seed));
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };
  const eyes = (img: ImageData, y = 5) => {
    for (const ox of [2, 11]) {
      px(img, ox, y, 246, 246, 246);
      px(img, ox, y + 1, 246, 246, 246);
      px(img, ox + 1, y, 24, 18, 22);
      px(img, ox + 1, y + 1, 24, 18, 22);
    }
  };

  // 猪:粉皮 + 猪鼻
  const pigSkin: Painter = (img, rng) => {
    noiseFill(img, rng, [236, 158, 148], 8);
    for (let i = 0; i < 6; i++) {
      px(img, (rng() * TS) | 0, (rng() * TS) | 0, 216, 134, 126);
    }
  };
  const pigBody = make(pigSkin, 555001);
  const pigFace = make((img, rng) => {
    pigSkin(img, rng);
    eyes(img);
    for (let y = 8; y <= 11; y++) {
      for (let x = 5; x <= 10; x++) {
        px(img, x, y, 224, 120, 132);
      }
    }
    px(img, 6, 9, 134, 62, 72);
    px(img, 6, 10, 134, 62, 72);
    px(img, 9, 9, 134, 62, 72);
    px(img, 9, 10, 134, 62, 72);
  }, 555002);

  // 羊:奶白卷毛 + 浅褐脸
  const wool: Painter = (img, rng) => {
    noiseFill(img, rng, [233, 231, 224], 6);
    for (let i = 0; i < 14; i++) {
      px(img, (rng() * TS) | 0, (rng() * TS) | 0, 210, 207, 197);
    }
  };
  const sheepHide: Painter = (img, rng) => {
    noiseFill(img, rng, [224, 200, 178], 8);
  };
  const sheepBody = make(wool, 556001);
  const sheepHead = make(sheepHide, 556002);
  const sheepFace = make((img, rng) => {
    sheepHide(img, rng);
    // 额头一撮羊毛
    for (let y = 0; y <= 2; y++) {
      for (let x = 3; x <= 12; x++) {
        const v = (rng() * 2 - 1) * 6;
        px(img, x, y, clamp255(233 + v), clamp255(231 + v), clamp255(224 + v));
      }
    }
    eyes(img, 6);
    // 粉鼻头
    px(img, 7, 11, 214, 150, 148);
    px(img, 8, 11, 214, 150, 148);
    px(img, 7, 12, 190, 124, 122);
    px(img, 8, 12, 190, 124, 122);
  }, 556003);

  // 鸡:白羽 + 黄喙红肉髯
  const feather: Painter = (img, rng) => {
    noiseFill(img, rng, [245, 243, 238], 5);
    for (let i = 0; i < 8; i++) {
      px(img, (rng() * TS) | 0, (rng() * TS) | 0, 224, 221, 214);
    }
  };
  const chickenBody = make(feather, 557001);
  const chickenFace = make((img, rng) => {
    feather(img, rng);
    eyes(img, 4);
    // 黄喙
    for (let y = 8; y <= 10; y++) {
      for (let x = 6; x <= 9; x++) {
        px(img, x, y, 238, 182, 38);
      }
    }
    // 红肉髯
    px(img, 7, 11, 196, 44, 38);
    px(img, 8, 11, 196, 44, 38);
    px(img, 7, 12, 172, 34, 30);
    px(img, 8, 12, 172, 34, 30);
  }, 557002);

  return {
    pig: { body: pigBody, head: pigBody, face: pigFace },
    sheep: { body: sheepBody, head: sheepHead, face: sheepFace },
    chicken: { body: chickenBody, head: chickenBody, face: chickenFace },
  };
}

/** 玩家(史蒂夫式)皮肤:头/脸/身/臂/腿 五张 16px 贴图 */
export interface SteveSkin {
  head: THREE.CanvasTexture;
  face: THREE.CanvasTexture;
  /** 全头发:头顶与后脑勺 */
  hair: THREE.CanvasTexture;
  /** 纯肤色:头底(下巴/脖子) */
  skin: THREE.CanvasTexture;
  body: THREE.CanvasTexture;
  arm: THREE.CanvasTexture;
  /** 全衣色:肩膀顶面 */
  sleeve: THREE.CanvasTexture;
  leg: THREE.CanvasTexture;
}

export function buildSteveTextures(): SteveSkin {
  const make = (paint: Painter, seed: number): THREE.CanvasTexture => {
    const canvas = document.createElement('canvas');
    canvas.width = TS;
    canvas.height = TS;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(TS, TS);
    paint(img, mulberry32(seed));
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };
  const skinTone: Painter = (img, rng) => {
    noiseFill(img, rng, [199, 156, 118], 6);
  };
  const hair = (img: ImageData, rows: number, rng: () => number) => {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < TS; x++) {
        const v = (rng() * 2 - 1) * 6;
        px(img, x, y, clamp255(58 + v), clamp255(40 + v), clamp255(26 + v));
      }
    }
  };
  // 头侧:肤色 + 上半头发
  const head = make((img, rng) => {
    skinTone(img, rng);
    hair(img, 6, rng);
  }, 661001);
  // 全头发:头顶与后脑勺
  const hairFull = make((img, rng) => {
    hair(img, TS, rng);
  }, 661006);
  // 纯肤色:头底
  const skinPlain = make((img, rng) => {
    skinTone(img, rng);
  }, 661008);
  // 脸:按原版史蒂夫 8px 布局 ×2 —— 刘海+鬓角、眼白在外瞳在内、
  // 居中鼻影、深棕嘴
  const face = make((img, rng) => {
    skinTone(img, rng);
    hair(img, 4, rng); // 刘海
    // 鬓角:两侧头发向下延伸
    for (let y = 4; y <= 6; y++) {
      for (const x of [0, 1, 14, 15]) {
        const v = (rng() * 2 - 1) * 6;
        px(img, x, y, clamp255(58 + v), clamp255(40 + v), clamp255(26 + v));
      }
    }
    // 眼(rows 8-9):白在外侧、蓝紫瞳在内侧(靠鼻),与原版一致
    for (const y of [8, 9]) {
      px(img, 2, y, 232, 232, 232);
      px(img, 3, y, 232, 232, 232);
      px(img, 4, y, 76, 60, 150);
      px(img, 5, y, 76, 60, 150);
      px(img, 10, y, 76, 60, 150);
      px(img, 11, y, 76, 60, 150);
      px(img, 12, y, 232, 232, 232);
      px(img, 13, y, 232, 232, 232);
    }
    // 鼻影(rows 10-11 居中)
    for (const y of [10, 11]) {
      for (let x = 6; x <= 9; x++) px(img, x, y, 154, 106, 74);
    }
    // 嘴(rows 12-13 居中,深棕)
    for (const y of [12, 13]) {
      for (let x = 6; x <= 9; x++) px(img, x, y, 96, 62, 44);
    }
  }, 661002);
  // 身:青色上衣
  const body = make((img, rng) => {
    noiseFill(img, rng, [0, 158, 158], 8);
    for (let x = 0; x < TS; x++) px(img, x, 0, 0, 132, 132);
  }, 661003);
  // 臂:肤色(短袖上臂两行衣色)
  const arm = make((img, rng) => {
    skinTone(img, rng);
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < TS; x++) {
        const v = (rng() * 2 - 1) * 8;
        px(img, x, y, clamp255(0 + v), clamp255(158 + v), clamp255(158 + v));
      }
    }
  }, 661004);
  // 全衣色:肩膀顶面
  const sleeve = make((img, rng) => {
    noiseFill(img, rng, [0, 152, 152], 8);
  }, 661007);
  // 腿:靛蓝裤 + 底部灰鞋
  const leg = make((img, rng) => {
    noiseFill(img, rng, [64, 70, 158], 8);
    for (let y = TS - 3; y < TS; y++) {
      for (let x = 0; x < TS; x++) {
        const v = (rng() * 2 - 1) * 6;
        px(img, x, y, clamp255(96 + v), clamp255(96 + v), clamp255(100 + v));
      }
    }
  }, 661005);
  return { head, face, hair: hairFull, skin: skinPlain, body, arm, sleeve, leg };
}

/** 柔边方形月亮:冷白色调,带几块月海暗斑 */
export function buildMoonTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.filter = 'blur(4px)';
  ctx.fillStyle = 'rgba(190, 204, 232, 0.75)';
  ctx.fillRect(18, 18, 28, 28);
  ctx.filter = 'blur(1px)';
  ctx.fillStyle = '#e6edfc';
  ctx.fillRect(23, 23, 18, 18);
  ctx.filter = 'blur(1.5px)';
  ctx.fillStyle = 'rgba(140, 156, 194, 0.8)';
  ctx.fillRect(26, 27, 7, 5);
  ctx.fillRect(34, 33, 5, 5);
  ctx.fillRect(27, 35, 4, 3);
  ctx.filter = 'none';
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.LinearFilter;
  return tex;
}
