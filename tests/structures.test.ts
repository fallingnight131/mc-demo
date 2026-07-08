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

  it('世界树:立于世界中央的巨木,中空可攀,壁龛与底顶藏宝,西兰花巨冠', () => {
    const { x, z, ground: g } = S.tree;
    expect(Math.hypot(x, z)).toBeLessThan(2); // 世界之轴
    expect(gen.biomeAt(x, z)).toBe('forest');
    // 树干壁为实木(半径 7 处从地面到高处全是原木)
    let log = 0;
    for (let y = g; y < g + 55; y++) {
      if (at(x + 7, y, z) === Block.Log) log++;
    }
    expect(log).toBeGreaterThan(48);
    // 中空:中心竖井直通树冠(台阶沿内壁,不占中心)
    let air = 0;
    for (let y = g + 2; y < g + 58; y++) {
      if (at(x, y, z) === Block.Air) air++;
    }
    expect(air).toBeGreaterThanOrEqual(54);
    // 螺旋台阶:绝大多数高度都有木板踏步
    let steps = 0;
    for (let y = g + 1; y < g + 61; y++) {
      let found = false;
      for (let dx = -6; dx <= 6 && !found; dx++) {
        for (let dz = -6; dz <= 6 && !found; dz++) {
          if (at(x + dx, y, z + dz) === Block.Plank) found = true;
        }
      }
      if (found) steps++;
    }
    expect(steps).toBeGreaterThan(52);
    // 宝箱:底层 1 + 两间壁龛 2 + 树冠王冠室 2
    expect(at(x, g + 1, z)).toBe(Block.Chest);
    expect(at(x + 4, g + 63, z)).toBe(Block.Chest);
    expect(at(x - 4, g + 63, z)).toBe(Block.Chest);
    const trunkChests = countIn(at, x - 9, x + 9, g + 10, g + 50, z - 9, z + 9, Block.Chest);
    expect(trunkChests).toBe(2); // 壁龛藏宝室
    // 西兰花巨冠:主椭球 + 枝头花球
    const leaves = countIn(at, x - 26, x + 26, g + 40, g + 80, z - 26, z + 26, Block.Leaves);
    expect(leaves).toBeGreaterThan(4000);
    // 四向门洞:四个正方向的干壁在门高处有开口
    for (const [dx, dz] of [[7, 0], [-7, 0], [0, 7], [0, -7]]) {
      expect(at(x + dx, g + 2, z + dz), `door ${dx},${dz}`).toBe(Block.Air);
    }
    // 萤石灯(壁灯 + 壁龛 + 王冠室灯环)
    const glow = countIn(at, x - 9, x + 9, g, g + 72, z - 9, z + 9, Block.Glowstone);
    expect(glow).toBeGreaterThanOrEqual(8);
    expect(S.lootAt(x, g + 1, z)).toBe('tree');
  });

  it('天空岛:6 座大小悬殊,湖泊与悬空细流,巨岛有天池与带墙神殿', () => {
    expect(S.islands.length).toBe(6);
    expect(S.islands[0].grand).toBe(true);
    expect(S.islands[0].r).toBeGreaterThan(20);
    for (const isl of S.islands) {
      expect(isl.y).toBeGreaterThanOrEqual(LAYER_SKY_BOTTOM + 6);
      // 岛心是神殿/神龛石砖地坪
      expect(at(isl.x, isl.y, isl.z)).toBe(Block.StoneBrick);
      // 悬空:岛底之下是天空
      expect(at(isl.x, isl.y - 16, isl.z)).toBe(Block.Air);
      // 中央宝箱 + 顶灯
      expect(at(isl.x, isl.y + 1, isl.z)).toBe(Block.Chest);
      expect(at(isl.x, isl.y + 5, isl.z)).toBe(Block.Glowstone);
      expect(S.lootAt(isl.x, isl.y + 1, isl.z)).toBe('sky');
      // 悬空细流:岛缘外挂着静态流水,数格后消散
      const rr = Math.ceil(isl.r) + 3;
      const flows = countIn(
        at,
        isl.x - rr, isl.x + rr,
        isl.y - 8, isl.y,
        isl.z - rr, isl.z + rr,
        Block.Flow2,
      );
      expect(flows, `island(${isl.x},${isl.z})`).toBeGreaterThanOrEqual(2);
    }
    const g0 = S.islands[0];
    // 天池:巨岛面上有一汪水
    const lake = countIn(at, g0.x - 24, g0.x + 24, g0.y - 2, g0.y, g0.z - 24, g0.z + 24, Block.Water);
    expect(lake).toBeGreaterThan(60);
    // 带墙神殿:砖墙围合
    const walls = countIn(at, g0.x - 6, g0.x + 6, g0.y + 1, g0.y + 4, g0.z - 6, g0.z + 6, Block.Brick);
    expect(walls).toBeGreaterThan(60);
    // 半径 ≥12 的小岛也都有自己的湖
    for (const i of S.islands) {
      if (i.grand || i.r < 12) continue;
      const w = countIn(
        at,
        Math.round(i.x - i.r), Math.round(i.x + i.r),
        i.y - 1, i.y,
        Math.round(i.z - i.r), Math.round(i.z + i.r),
        Block.Water,
      );
      expect(w, `lake(${i.x},${i.z}) r=${i.r.toFixed(1)}`).toBeGreaterThan(6);
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

  it('地狱遗迹:灰烬岸上的两层黑曜石楼房,地狱石光柱,层层藏宝与地灯', () => {
    expect(S.hellForts.length).toBeGreaterThanOrEqual(2);
    for (const f of S.hellForts) {
      const base = gen.hellFloor(f.x, f.z) + 1; // 楼房坐落在本地灰烬岸上
      const yl = base - 1;
      const yh = base + 13;
      const obsidian = countIn(at, f.x - 5, f.x + 5, yl, yh, f.z - 5, f.z + 5, Block.Obsidian);
      expect(obsidian).toBeGreaterThan(80); // 两层楼比旧残垣更多黑曜石
      const chests = countIn(at, f.x - 5, f.x + 5, yl, yh, f.z - 5, f.z + 5, Block.Chest);
      expect(chests).toBe(4); // 层层藏宝:两层各两箱
      const hellstone = countIn(at, f.x - 5, f.x + 5, yl, yh, f.z - 5, f.z + 5, Block.Hellstone);
      expect(hellstone).toBeGreaterThan(20); // 四角地狱石光柱
      expect(at(f.x, base, f.z)).toBe(Block.Glowstone);
      expect(S.lootAt(f.x - 2, base + 1, f.z)).toBe('hell');
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
    expect(gen.structures.suppressSurfaceAt(70, 70)).toBe(false); // 树冠之外照常长树
  });
});
