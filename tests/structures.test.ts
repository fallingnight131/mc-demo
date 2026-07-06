import { describe, expect, it } from 'vitest';
import { Block } from '../src/blocks';
import { LAVA_LEVEL, LAYER_SKY_BOTTOM, SEA_LEVEL } from '../src/config';
import { Generator } from '../src/worldgen';

const CS = 16;

/** 跨区块方块读取器(按需生成并缓存区块) */
function makeAccessor(gen: Generator) {
  const cache = new Map<string, Uint8Array>();
  return (x: number, y: number, z: number): number => {
    const cx = Math.floor(x / CS);
    const cz = Math.floor(z / CS);
    const k = cx + ',' + cz;
    let d = cache.get(k);
    if (!d) {
      d = gen.generateChunk(cx, cz);
      cache.set(k, d);
    }
    return d[(y * CS + (z - cz * CS)) * CS + (x - cx * CS)];
  };
}

type At = (x: number, y: number, z: number) => number;

function countIn(
  at: At,
  x0: number, x1: number,
  y0: number, y1: number,
  z0: number, z1: number,
  id: number,
): number {
  let n = 0;
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        if (at(x, y, z) === id) n++;
      }
    }
  }
  return n;
}

describe('Terraria 3D 地标', () => {
  const gen = new Generator(1337);
  const S = gen.structures;
  const at = makeAccessor(gen);

  it('世界树:出生地附近的森林巨木,中空可攀,底顶藏宝,顶冠巨大', () => {
    const { x, z, ground: g } = S.tree;
    const d = Math.hypot(x, z);
    expect(d).toBeGreaterThan(50);
    expect(d).toBeLessThan(120);
    expect(gen.biomeAt(x, z)).toBe('forest');
    // 树干壁为实木(半径 4 处从地面到高处全是原木)
    let log = 0;
    for (let y = g; y < g + 40; y++) {
      if (at(x + 4, y, z) === Block.Log) log++;
    }
    expect(log).toBeGreaterThan(35);
    // 中空:中心竖井直通树冠(台阶沿内壁,不占中心)
    let air = 0;
    for (let y = g + 2; y < g + 40; y++) {
      if (at(x, y, z) === Block.Air) air++;
    }
    expect(air).toBeGreaterThanOrEqual(37);
    // 螺旋台阶:绝大多数高度都有木板踏步
    let steps = 0;
    for (let y = g + 1; y < g + 43; y++) {
      let found = false;
      for (let dx = -3; dx <= 3 && !found; dx++) {
        for (let dz = -3; dz <= 3 && !found; dz++) {
          if (at(x + dx, y, z + dz) === Block.Plank) found = true;
        }
      }
      if (found) steps++;
    }
    expect(steps).toBeGreaterThan(35);
    // 宝箱:底层 1 + 树冠平台 2
    expect(at(x, g + 1, z)).toBe(Block.Chest);
    expect(at(x + 3, g + 45, z)).toBe(Block.Chest);
    expect(at(x - 3, g + 45, z)).toBe(Block.Chest);
    // 巨大树冠
    const leaves = countIn(at, x - 14, x + 14, g + 40, g + 56, z - 14, z + 14, Block.Leaves);
    expect(leaves).toBeGreaterThan(600);
    // 内壁萤石灯
    const glow = countIn(at, x - 5, x + 5, g, g + 50, z - 5, z + 5, Block.Glowstone);
    expect(glow).toBeGreaterThanOrEqual(4);
    expect(S.lootAt(x, g + 1, z)).toBe('tree');
  });

  it('天空岛:≥4 座浮于天空层,草皮岛面、底下悬空、神龛藏宝', () => {
    expect(S.islands.length).toBeGreaterThanOrEqual(4);
    for (const isl of S.islands) {
      expect(isl.y).toBeGreaterThanOrEqual(LAYER_SKY_BOTTOM + 6);
      // 岛心是神龛石砖地台,周围环草皮
      expect(at(isl.x, isl.y, isl.z)).toBe(Block.StoneBrick);
      let grass = 0;
      for (let a = 0; a < 8; a++) {
        const dx = Math.round(Math.cos((a * Math.PI) / 4) * (isl.r - 2.2));
        const dz = Math.round(Math.sin((a * Math.PI) / 4) * (isl.r - 2.2));
        if (at(isl.x + dx, isl.y, isl.z + dz) === Block.Grass) grass++;
      }
      expect(grass).toBeGreaterThanOrEqual(4);
      // 悬空:岛底之下是天空
      expect(at(isl.x, isl.y - 16, isl.z)).toBe(Block.Air);
      // 神龛宝箱 + 顶灯
      expect(at(isl.x, isl.y + 1, isl.z)).toBe(Block.Chest);
      expect(at(isl.x, isl.y + 5, isl.z)).toBe(Block.Glowstone);
      expect(S.lootAt(isl.x, isl.y + 1, isl.z)).toBe('sky');
    }
  });

  it('地牢:海岸蓝砖塔楼,地下三层迷宫房间,萤石照明,底层宝库', () => {
    const { x, z, ground: g } = S.dungeon;
    expect(Math.hypot(x, z)).toBeGreaterThan(280); // 海岸带
    expect(g).toBeGreaterThanOrEqual(SEA_LEVEL + 4); // 在陆地上
    const brick = countIn(at, x - 12, x + 12, g - 26, g + 8, z - 12, z + 12, Block.DungeonBrick);
    expect(brick).toBeGreaterThan(6000);
    // 迷宫房间被掏空
    const air = countIn(at, x - 11, x + 11, g - 25, g - 1, z - 11, z + 11, Block.Air);
    expect(air).toBeGreaterThan(1200);
    // 8 座宝箱(上两层 2+2,底层四角宝库)
    const chests = countIn(at, x - 12, x + 12, g - 26, g + 8, z - 12, z + 12, Block.Chest);
    expect(chests).toBe(8);
    // 萤石照明(房顶 + 竖井壁 + 塔楼)
    const glow = countIn(at, x - 12, x + 12, g - 26, g + 9, z - 12, z + 12, Block.Glowstone);
    expect(glow).toBeGreaterThanOrEqual(12);
    // 底层宝库的金块/钻石块
    const gold = countIn(at, x - 12, x + 12, g - 26, g - 20, z - 12, z + 12, Block.GoldBlock);
    const diamond = countIn(at, x - 12, x + 12, g - 26, g - 20, z - 12, z + 12, Block.DiamondBlock);
    expect(gold).toBeGreaterThanOrEqual(4);
    expect(diamond).toBeGreaterThanOrEqual(2);
    expect(S.lootAt(x - 8, g - 10, z - 8)).toBe('dungeon');
  });

  it('地狱遗迹:灰烬岸上的黑曜石残垣,地狱石棱角,藏宝与地灯', () => {
    expect(S.hellForts.length).toBeGreaterThanOrEqual(2);
    for (const f of S.hellForts) {
      const obsidian = countIn(at, f.x - 5, f.x + 5, 8, 18, f.z - 5, f.z + 5, Block.Obsidian);
      expect(obsidian).toBeGreaterThan(60);
      const chests = countIn(at, f.x - 5, f.x + 5, 8, 18, f.z - 5, f.z + 5, Block.Chest);
      expect(chests).toBe(2);
      expect(at(f.x, LAVA_LEVEL + 2, f.z)).toBe(Block.Glowstone);
      expect(S.lootAt(f.x - 2, LAVA_LEVEL + 3, f.z)).toBe('hell');
    }
  });

  it('地标选址确定性:同种子生成器给出一致位置', () => {
    const gen2 = new Generator(1337);
    expect(gen2.structures.tree).toEqual(S.tree);
    expect(gen2.structures.dungeon).toEqual(S.dungeon);
    expect(gen2.structures.islands).toEqual(S.islands);
    expect(gen2.structures.hellForts).toEqual(S.hellForts);
  });

  it('地标脚下不长树(世界树/地牢的地基不被野树穿插)', () => {
    expect(gen.structures.suppressSurfaceAt(S.tree.x + 3, S.tree.z)).toBe(true);
    expect(gen.structures.suppressSurfaceAt(S.dungeon.x, S.dungeon.z + 5)).toBe(true);
    expect(gen.structures.suppressSurfaceAt(0, 0)).toBe(false);
  });
});
