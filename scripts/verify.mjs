// 运行时验证:无头 Chrome 实际游玩 —— 移动 / 跳跃 / 挖掘 / 放置 / 截图
// 用法:node scripts/verify.mjs(需要 dev 服务器已在 5173 端口运行)
import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = 'scripts/shots';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

const errors = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://localhost:5173/?test', { waitUntil: 'load' });
// 清掉历史存档,保证每次验证从全新世界开始
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('canvas.game', { timeout: 15000 });
await page.waitForTimeout(2500);

const pos = () =>
  page.evaluate(() => {
    const p = window.__game.player.pos;
    return [p.x, p.y, p.z];
  });
const blockAt = (x, y, z) =>
  page.evaluate(([x, y, z]) => window.__game.world.getBlock(x, y, z), [x, y, z]);
const look = (mx, my, steps = 20) =>
  page.evaluate(
    ([mx, my, steps]) => {
      for (let i = 0; i < steps; i++) {
        document.dispatchEvent(new MouseEvent('mousemove', { movementX: mx, movementY: my }));
      }
    },
    [mx, my, steps],
  );

const p0 = await pos();
console.log('spawn:', p0.map((v) => v.toFixed(2)).join(' / '));
await page.screenshot({ path: `${OUT}/1-game.png` });

// --- 行走(遇 1 格台阶按 MC 规则跳跃通过)---
await page.keyboard.down('KeyW');
for (let i = 0; i < 4; i++) {
  await page.waitForTimeout(250);
  await page.keyboard.down('Space');
  await page.waitForTimeout(80);
  await page.keyboard.up('Space');
}
await page.keyboard.up('KeyW');
await page.waitForTimeout(600);
const p1 = await pos();
const walked = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
check('WASD 行走', walked > 2.5, `移动 ${walked.toFixed(2)} 格`);
await page.screenshot({ path: `${OUT}/2-moved.png` });

// --- 跳跃 ---
await page.keyboard.down('Space');
await page.waitForTimeout(120);
await page.keyboard.up('Space');
await page.waitForTimeout(180);
const pJump = await pos();
check('跳跃', pJump[1] > p1[1] + 0.5, `离地 ${(pJump[1] - p1[1]).toFixed(2)} 格`);
await page.waitForTimeout(700); // 落地

// --- 挖掘:垂直向下挖三格 ---
// 先把玩家对齐到所站方块中心,保证准星与支撑方块同列
await page.evaluate(() => {
  const g = window.__game;
  const p = g.player;
  const x = Math.floor(p.pos.x);
  const z = Math.floor(p.pos.z);
  let y = Math.floor(p.pos.y);
  while (y > 1 && !g.world.isSolid(x, y - 1, z)) y--;
  p.pos.set(x + 0.5, y + 0.01, z + 0.5);
  p.vel.set(0, 0, 0);
});
await look(0, 40, 30); // 压到最大俯角
await page.waitForTimeout(150);
const pd = await pos();
const bx = Math.floor(pd[0]);
const bz = Math.floor(pd[2]);
const startY = Math.floor(pd[1] - 0.5); // 脚下方块
await page.screenshot({ path: `${OUT}/3-before-dig.png` });

// 轻点一下不应破坏(挖掘需要时间)
await page.mouse.down();
await page.waitForTimeout(60);
await page.mouse.up();
await page.waitForTimeout(150);
check('轻点不破坏', (await blockAt(bx, startY, bz)) !== 0, `脚下方块仍在`);

// 按住左键持续挖掘,中途抓拍裂纹
await page.mouse.down();
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/3b-mining-crack.png` });
let dug = false;
const digStart = Date.now();
while (Date.now() - digStart < 9000) {
  await page.waitForTimeout(200);
  if (
    (await blockAt(bx, startY, bz)) === 0 &&
    (await blockAt(bx, startY - 1, bz)) === 0 &&
    (await blockAt(bx, startY - 2, bz)) === 0
  ) {
    dug = true;
    break;
  }
}
await page.mouse.up();
await page.waitForTimeout(400);
const pAfterDig = await pos();
check(
  '按住挖掘三格',
  dug && pAfterDig[1] < pd[1] - 2.5,
  `下沉 ${(pd[1] - pAfterDig[1]).toFixed(2)} 格,耗时 ${((Date.now() - digStart) / 1000).toFixed(1)}s`,
);
await page.screenshot({ path: `${OUT}/4-after-dig.png` });

// 掉落物应被自动吸附拾取(玩家就站在挖掘坑里)
await page.waitForTimeout(1200);
const pickState = await page.evaluate(() => ({
  picked: window.__game.stats.pickups,
  remaining: window.__game.drops.count,
}));
check(
  '掉落物拾取',
  pickState.picked >= 3 && pickState.remaining === 0,
  `已拾取 ${pickState.picked} 个,场上剩余 ${pickState.remaining}`,
);
// 物品栏计数徽章:挖的柱子是草×1 + 泥土×2
const dirtBadge = await page.evaluate(
  () => document.querySelectorAll('#hotbar .slot')[1].querySelector('.slot-count').textContent,
);
check('拾取计数徽章', dirtBadge === '2', `泥土槽位显示 "${dirtBadge}"(应为 2)`);

// 静音切换(M 键)
await page.keyboard.press('KeyM');
await page.waitForTimeout(120);
const muted1 = await page.evaluate(() => window.__game.sound.muted);
await page.keyboard.press('KeyM');
await page.waitForTimeout(120);
const muted2 = await page.evaluate(() => window.__game.sound.muted);
check('静音切换', muted1 === true && muted2 === false, `M → ${muted1},再按 → ${muted2}`);

// --- 放置:跳跃垫块两次(圆石) ---
await page.keyboard.press('Digit4');
await page.waitForTimeout(120);
for (let i = 0; i < 2; i++) {
  await page.keyboard.down('Space');
  await page.waitForTimeout(120);
  await page.keyboard.up('Space');
  await page.waitForTimeout(160); // 接近跳跃顶点
  await page.mouse.down({ button: 'right' });
  await page.waitForTimeout(60);
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(600); // 落稳
}
const pAfterPlace = await pos();
const under = await blockAt(
  Math.floor(pAfterPlace[0]),
  Math.floor(pAfterPlace[1] - 0.5),
  Math.floor(pAfterPlace[2]),
);
check(
  '跳跃垫块',
  pAfterPlace[1] > pAfterDig[1] + 1.5 && under === 8,
  `回升 ${(pAfterPlace[1] - pAfterDig[1]).toFixed(2)} 格,脚下方块 id=${under}(圆石=8)`,
);
await page.screenshot({ path: `${OUT}/5-after-place.png` });

// --- 中键选取:对准脚下圆石,选中后物品栏应切到圆石 ---
await page.keyboard.press('Digit1');
await page.mouse.down({ button: 'middle' });
await page.mouse.up({ button: 'middle' });
await page.waitForTimeout(150);
const slotSel = await page.evaluate(
  () =>
    [...document.querySelectorAll('#hotbar .slot')].findIndex((el) =>
      el.classList.contains('selected'),
    ),
);
check('中键选取', slotSel === 3, `选中槽位 ${slotSel + 1}(圆石应为 4)`);

// --- 背包:E 打开,点选砖块放入当前槽位,再放置到世界 ---
await page.keyboard.press('Digit5'); // 选中槽位 5(默认木板)
await page.waitForTimeout(120);
await page.keyboard.press('KeyE');
await page.waitForTimeout(250);
const invOpen = await page.evaluate(() =>
  document.getElementById('inventory').classList.contains('open'),
);
await page.screenshot({ path: `${OUT}/9-inventory.png` });
await page.click('#inv-grid .inv-slot[title="砖块"]');
await page.waitForTimeout(250);
const invClosed = await page.evaluate(
  () => !document.getElementById('inventory').classList.contains('open'),
);
const slotBlock = await page.evaluate(
  () => window.__game.ui.hotbar()[window.__game.ui.selected()],
);
check(
  '背包选块',
  invOpen && invClosed && slotBlock === 19,
  `打开 ${invOpen},点选后关闭 ${invClosed},当前槽位方块 id=${slotBlock}(砖块=19)`,
);

// 把砖块放到面前的地上
await page.evaluate(() => {
  const g = window.__game;
  const s = g.spawn;
  const x = Math.floor(s.x) - 3;
  const z = Math.floor(s.z);
  const h = g.world.gen.heightAt(x, z);
  g.player.pos.set(x + 0.5, h + 1.01, z + 0.5);
  g.player.vel.set(0, 0, 0);
  g.player.yaw = 0;
  g.player.pitch = -0.65;
});
await page.waitForTimeout(300);
await page.mouse.down({ button: 'right' });
await page.mouse.up({ button: 'right' });
await page.waitForTimeout(250);
const brickPlaced = await page.evaluate(() => {
  const g = window.__game;
  const p = g.player.pos;
  for (let dy = 2; dy >= -3; dy--) {
    for (let dx = -5; dx <= 5; dx++) {
      for (let dz = -5; dz <= 5; dz++) {
        const id = g.world.getBlock(
          Math.floor(p.x) + dx,
          Math.floor(p.y) + dy,
          Math.floor(p.z) + dz,
        );
        if (id === 19) return true;
      }
    }
  }
  return false;
});
check('放置新方块(砖块)', brickPlaced, `世界中出现砖块 ${brickPlaced}`);
await page.keyboard.press('Digit1'); // 复位选中槽位

// --- 生物:生成小猪 → 逐拳追击,三拳白烟击杀 ---
await page.evaluate(() => {
  const g = window.__game;
  g.mobs.setAutoSpawn(false); // 测试期间不自然生成
  g.mobs.clear();
  const s = g.spawn;
  const x = Math.floor(s.x) + 3;
  const z = Math.floor(s.z);
  const h = g.world.gen.heightAt(x, z);
  g.mobs.spawnAt(x + 0.5, h + 1.01, z + 0.5);
  // 玩家站到猪西侧 2.5 格,面向它
  g.player.pos.set(x - 2, h + 1.01, z + 0.5);
  g.player.vel.set(0, 0, 0);
  g.player.yaw = Math.atan2(-2.5, 0);
  g.player.pitch = -0.4;
});
await page.waitForTimeout(400);
const pigSpawned = await page.evaluate(() => window.__game.mobs.count());
await page.screenshot({ path: `${OUT}/11-pig.png` });
let punches = 0;
while (punches < 8 && (await page.evaluate(() => window.__game.mobs.count())) > 0) {
  // 猪会跑,每拳前传送到它旁边并瞄准
  await page.evaluate(() => {
    const g = window.__game;
    const list = g.mobs.list();
    if (!list.length) return;
    const m = list[0];
    g.player.pos.set(m.x - 2, m.y, m.z);
    g.player.vel.set(0, 0, 0);
    const dx = m.x - g.player.pos.x;
    const dz = m.z - g.player.pos.z;
    g.player.yaw = Math.atan2(-dx, -dz);
    g.player.pitch = -0.42;
  });
  await page.waitForTimeout(150);
  await page.mouse.down();
  await page.mouse.up();
  punches++;
  await page.waitForTimeout(400);
}
const pigsLeft = await page.evaluate(() => window.__game.mobs.count());
check(
  '生物:小猪击杀',
  pigSpawned === 1 && pigsLeft === 0 && punches >= 3,
  `生成 ${pigSpawned} 只,${punches} 拳后剩余 ${pigsLeft}(3 拳应击杀)`,
);

// --- 羊与鸡:生成到面前合影 ---
await page.evaluate(() => {
  const g = window.__game;
  const s = g.spawn;
  const x = Math.floor(s.x);
  const z = Math.floor(s.z);
  g.mobs.spawnAt(x + 1.5, g.world.gen.heightAt(x + 1, z + 3) + 1.01, z + 3.5, 'sheep');
  g.mobs.spawnAt(x + 3.5, g.world.gen.heightAt(x + 3, z + 3) + 1.01, z + 3.5, 'chicken');
  g.player.pos.set(x + 2.5, g.world.gen.heightAt(x + 2, z) + 1.01, z + 0.5);
  g.player.vel.set(0, 0, 0);
  g.player.yaw = Math.PI; // 面向 +z
  g.player.pitch = -0.25;
});
await page.waitForTimeout(400);
const flock = await page.evaluate(() =>
  window.__game.mobs
    .list()
    .map((m) => m.kind)
    .sort()
    .join(','),
);
await page.screenshot({ path: `${OUT}/11b-flock.png` });
check('生物:羊与鸡生成', flock === 'chicken,sheep', `场上生物: ${flock}`);

// --- TNT:放置 → 点燃 → 爆出弹坑 ---
// 传送到出生点旁的平整草地,面向 -z 俯视,保证放置射线命中地面顶面
await page.evaluate(() => {
  const g = window.__game;
  const s = g.spawn;
  const x = Math.floor(s.x) + 2;
  const z = Math.floor(s.z);
  const h = g.world.gen.heightAt(x, z);
  g.player.pos.set(x + 0.5, h + 1.01, z + 0.5);
  g.player.vel.set(0, 0, 0);
  g.player.yaw = 0;
  g.player.pitch = -0.65;
});
await page.waitForTimeout(300);
await page.keyboard.press('Digit0'); // 选中 TNT
await page.waitForTimeout(150);
await page.mouse.down({ button: 'right' }); // 放置
await page.mouse.up({ button: 'right' });
await page.waitForTimeout(200);
const tntPos = await page.evaluate(() => {
  const g = window.__game;
  const p = g.player.pos;
  for (let dy = 3; dy >= -3; dy--) {
    for (let dx = -6; dx <= 6; dx++) {
      for (let dz = -6; dz <= 6; dz++) {
        const x = Math.floor(p.x) + dx;
        const y = Math.floor(p.y) + dy;
        const z = Math.floor(p.z) + dz;
        if (g.world.getBlock(x, y, z) === 17) return { x, y, z };
      }
    }
  }
  return null;
});
if (tntPos) {
  const groundBefore = await blockAt(tntPos.x, tntPos.y - 1, tntPos.z);
  await page.mouse.down({ button: 'right' }); // 点燃
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(700);
  const ignited = (await blockAt(tntPos.x, tntPos.y, tntPos.z)) === 0;
  await page.screenshot({ path: `${OUT}/5a-tnt-primed.png` });
  await page.waitForTimeout(2600); // 等引信 + 爆炸
  const groundAfter = await blockAt(tntPos.x, tntPos.y - 1, tntPos.z);
  // 统计弹坑空洞规模
  const crater = await page.evaluate(({ x, y, z }) => {
    const g = window.__game;
    let air = 0;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dz = -2; dz <= 2; dz++) {
          if (g.world.getBlock(x + dx, y + dy, z + dz) === 0) air++;
        }
      }
    }
    return air;
  }, tntPos);
  check(
    'TNT 爆炸成坑',
    ignited && groundBefore !== 0 && groundAfter === 0 && crater > 60,
    `点燃 ${ignited},地面 ${groundBefore}→${groundAfter},5³ 范围空洞 ${crater}/125`,
  );
  await page.screenshot({ path: `${OUT}/5a-tnt-crater.png` });
} else {
  check('TNT 爆炸成坑', false, '未能放置 TNT');
}
await page.keyboard.press('Digit4'); // 切回圆石,避免影响后续
await page.waitForTimeout(120);

// --- TNT 波及生物:贴着 TNT 的猪被炸死或炸伤 ---
await page.evaluate(() => {
  const g = window.__game;
  g.mobs.clear();
  const s = g.spawn;
  const x = Math.floor(s.x) - 6;
  const z = Math.floor(s.z) - 4;
  const h = g.world.gen.heightAt(x, z);
  g.mobs.spawnAt(x + 1.5, g.world.gen.heightAt(x + 1, z) + 1.01, z + 0.5, 'pig');
  g.world.setBlock(x, h + 1, z, 17); // 放 TNT 方块
  // 玩家站到 4 格外,精确瞄准 TNT 中心
  const py = g.world.gen.heightAt(x, z + 4) + 1.01;
  g.player.pos.set(x + 0.5, py, z + 4.5);
  g.player.vel.set(0, 0, 0);
  g.player.yaw = 0; // 面向 -z
  g.player.pitch = Math.atan((h + 1.5 - (py + 1.62)) / 4);
});
await page.waitForTimeout(250);
await page.mouse.down({ button: 'right' }); // 点燃
await page.mouse.up({ button: 'right' });
await page.waitForTimeout(3200); // 引信 2.2s + 爆炸落定
const mobBlast = await page.evaluate(() => {
  const g = window.__game;
  const list = g.mobs.list();
  return { count: g.mobs.count(), hp: list[0]?.hp ?? -1 };
});
check(
  'TNT 波及生物',
  mobBlast.count === 0 || mobBlast.hp < 3,
  mobBlast.count === 0 ? '猪被炸死' : `猪受伤,hp=${mobBlast.hp}`,
);
await page.evaluate(() => window.__game.mobs.setAutoSpawn(true));

// --- 水流:挖开湖岸,水应当涌入缺口 ---
const shore = await page.evaluate(() => {
  const g = window.__game;
  const SEA = 24;
  for (let r = 4; r < 120; r++) {
    for (let a = 0; a < 24; a++) {
      const x = Math.round(Math.cos((a / 24) * Math.PI * 2) * r);
      const z = Math.round(Math.sin((a / 24) * Math.PI * 2) * r);
      if (g.world.gen.heightAt(x, z) !== SEA) continue; // 岸:海平面同高的沙地
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (g.world.gen.heightAt(x + dx, z + dz) < SEA) {
          return { bx: x, bz: z, ax: x + dx, az: z + dz };
        }
      }
    }
  }
  return null;
});
if (shore) {
  await page.evaluate(({ bx, bz }) => {
    const g = window.__game;
    g.world.warmup(Math.floor(bx / 16), Math.floor(bz / 16));
    // 站到缺口斜后方,看向缺口
    const px = bx + 0.5;
    const pz = bz + 3.5;
    g.player.pos.set(px, 28, pz);
    g.player.vel.set(0, 0, 0);
    g.player.pitch = -0.5;
    g.player.yaw = Math.atan2(-(bx + 0.5 - px), -(bz + 0.5 - pz));
  }, shore);
  await page.waitForTimeout(500);
  // 挖开岸边方块(等价于玩家挖掘的结果)
  await page.evaluate(({ bx, bz }) => window.__game.world.setBlock(bx, 24, bz, 0), shore);
  await page.waitForTimeout(2200); // 等待水流 tick
  const filled = await page.evaluate(
    ({ bx, bz }) => {
      const id = window.__game.world.getBlock(bx, 24, bz);
      return { id, isWater: id === 10 || (id >= 13 && id <= 16) };
    },
    shore,
  );
  check('水流涌入缺口', filled.isWater, `缺口方块 id=${filled.id}(13-16 为流水)`);
  await page.screenshot({ path: `${OUT}/5b-water-flow.png` });
} else {
  console.log('SKIP  水流(附近没找到合适湖岸)');
}

// --- 游泳:传送进湖里,按空格上浮 ---
const water = await page.evaluate(() => {
  const g = window.__game;
  for (let r = 4; r < 96; r += 2) {
    for (let a = 0; a < 16; a++) {
      const x = Math.round(Math.cos((a / 16) * Math.PI * 2) * r);
      const z = Math.round(Math.sin((a / 16) * Math.PI * 2) * r);
      if (g.world.gen.heightAt(x, z) <= 24 - 3) return { x, z };
    }
  }
  return null;
});
if (water) {
  await page.evaluate(({ x, z }) => {
    const g = window.__game;
    g.world.warmup(Math.floor(x / 16), Math.floor(z / 16));
    g.player.pos.set(x + 0.5, 22, z + 0.5);
    g.player.vel.set(0, 0, 0);
  }, water);
  await page.waitForTimeout(600);
  const inWater = await page.evaluate(() => window.__game.player.isInWater());
  const tintVisible = await page.evaluate(() =>
    document.getElementById('water-tint').classList.contains('visible'),
  );
  await page.screenshot({ path: `${OUT}/6-underwater.png` });
  const y0 = (await pos())[1];
  await page.keyboard.down('Space');
  await page.waitForTimeout(1500);
  await page.keyboard.up('Space');
  const y1 = (await pos())[1];
  check('游泳上浮', inWater && y1 > y0 + 0.8, `水中 ${inWater},上浮 ${(y1 - y0).toFixed(2)} 格,水下色调 ${tintVisible}`);
  // 回到岸上
  await page.evaluate(() => {
    const g = window.__game;
    const s = g.spawn;
    g.player.pos.set(s.x, s.y + 1, s.z);
    g.player.vel.set(0, 0, 0);
  });
  await page.waitForTimeout(400);
} else {
  console.log('SKIP  游泳(附近没有足够深的水域)');
}

// --- 出水上岸:在水里贴着岸推进 + 跳跃,应能翻上 1 格高的沙岸 ---
const shore2 = await page.evaluate((skip) => {
  const g = window.__game;
  const SEA = 24;
  for (let r = 4; r < 120; r++) {
    for (let a = 0; a < 24; a++) {
      const x = Math.round(Math.cos((a / 24) * Math.PI * 2) * r);
      const z = Math.round(Math.sin((a / 24) * Math.PI * 2) * r);
      if (skip && x === skip.bx && z === skip.bz) continue; // 避开已被挖开的岸
      if (g.world.gen.heightAt(x, z) !== SEA) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (g.world.gen.heightAt(x + dx, z + dz) < SEA) {
          return { bx: x, bz: z, ax: x + dx, az: z + dz };
        }
      }
    }
  }
  return null;
}, shore);
if (shore2) {
  await page.evaluate(({ ax, az, bx, bz }) => {
    const g = window.__game;
    g.world.warmup(Math.floor(ax / 16), Math.floor(az / 16));
    // 站进岸边的水里,面向沙岸
    g.player.pos.set(ax + 0.5, 24.2, az + 0.5);
    g.player.vel.set(0, 0, 0);
    g.player.pitch = -0.2;
    g.player.yaw = Math.atan2(-(bx - ax), -(bz - az));
  }, shore2);
  await page.waitForTimeout(600);
  const wet = await page.evaluate(() => window.__game.player.isTouchingWater());
  await page.keyboard.down('KeyW');
  await page.keyboard.down('Space');
  await page.waitForTimeout(3500);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('Space');
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => {
    const g = window.__game;
    return { y: g.player.pos.y, wet: g.player.isTouchingWater() };
  });
  check(
    '游泳出水上岸',
    wet && !after.wet && after.y >= 24.9,
    `入水 ${wet} → 出水 ${!after.wet},最终高度 y=${after.y.toFixed(2)}(岸面 25)`,
  );
  await page.screenshot({ path: `${OUT}/6b-climb-out.png` });
} else {
  console.log('SKIP  出水上岸(没找到合适湖岸)');
}

// --- 存档:保存 → 刷新页面 → 世界改动与玩家状态恢复 ---
const snap = await page.evaluate(() => {
  const g = window.__game;
  g.save();
  const p = g.player.pos;
  return { x: p.x, y: p.y, z: p.z };
});
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('canvas.game', { timeout: 15000 });
await page.waitForTimeout(2000);
const restored = await page.evaluate(() => {
  const g = window.__game;
  const p = g.player.pos;
  return { x: p.x, y: p.y, z: p.z };
});
const holeStill = await blockAt(bx, startY, bz); // 挖掘阶段的洞应当还在
const posOk =
  Math.abs(restored.x - snap.x) < 1.5 &&
  Math.abs(restored.y - snap.y) < 2.5 &&
  Math.abs(restored.z - snap.z) < 1.5;
check(
  '存档恢复',
  posOk && holeStill === 0,
  `位置 (${restored.x.toFixed(1)},${restored.y.toFixed(1)},${restored.z.toFixed(1)}) ≈ 保存点,挖的洞仍为空气 ${holeStill === 0}`,
);

// --- 地底坏存档自救:读档位置嵌在石头里 → 回到出生点 ---
await page.evaluate(() => {
  const g = window.__game;
  g.player.pos.set(g.spawn.x, 3, g.spawn.z); // 卡进地底深处
  g.player.vel.set(0, 0, 0);
  g.save();
});
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('canvas.game', { timeout: 15000 });
await page.waitForTimeout(2000);
const rescued = await page.evaluate(() => {
  const g = window.__game;
  return { y: g.player.pos.y, spawnY: g.spawn.y };
});
check(
  '地底坏存档自救',
  Math.abs(rescued.y - rescued.spawnY) < 3,
  `读档位置 y=${rescued.y.toFixed(1)}(出生点 y=${rescued.spawnY.toFixed(1)})`,
);

// --- 清除存档:重开后存档为空、回到全新世界(回归:reload 时自动存档不得写回) ---
await Promise.all([
  page.waitForNavigation({ waitUntil: 'load' }),
  page.evaluate(() => document.getElementById('reset-save').click()).catch(() => {}),
]);
await page.waitForSelector('canvas.game', { timeout: 15000 });
await page.waitForTimeout(1500);
const fresh = await page.evaluate(() => {
  const g = window.__game;
  const p = g.player.pos;
  return {
    save: localStorage.getItem('mc-demo-save-v1'),
    nearSpawn: Math.hypot(p.x - g.spawn.x, p.y - g.spawn.y, p.z - g.spawn.z) < 3,
  };
});
check(
  '清除存档重开',
  fresh.save === null && fresh.nearSpawn,
  `存档已清 ${fresh.save === null},回到出生点 ${fresh.nearSpawn}`,
);

// --- 昼夜循环:拨到黄昏与午夜,亮度骤降、星星出现、雾色变暗 ---
await page.evaluate(() => window.__game.setTime(0.25)); // 正午基准
await page.waitForTimeout(250);
const envDay = await page.evaluate(() => window.__game.env());
await page.evaluate(() => window.__game.setTime(0.505)); // 日落
await page.waitForTimeout(350);
await page.screenshot({ path: `${OUT}/8-dusk.png` });
await page.evaluate(() => window.__game.setTime(0.75)); // 午夜
await page.waitForTimeout(350);
const envNight = await page.evaluate(() => window.__game.env());
await page.screenshot({ path: `${OUT}/8b-night.png` });
const fogLum = (f) => f[0] + f[1] + f[2];
check(
  '昼夜循环',
  envDay.brightness > 0.95 &&
    envNight.brightness < 0.2 &&
    envDay.starAlpha === 0 &&
    envNight.starAlpha === 1 &&
    fogLum(envNight.fog) < fogLum(envDay.fog) * 0.3,
  `亮度 ${envDay.brightness.toFixed(2)}→${envNight.brightness.toFixed(2)},星星 ${envDay.starAlpha}→${envNight.starAlpha},雾亮度 ${fogLum(envDay.fog).toFixed(2)}→${fogLum(envNight.fog).toFixed(2)}`,
);
await page.evaluate(() => window.__game.setTime(0.25)); // 回到白天
await page.waitForTimeout(250);

// --- 环顾远景 ---
await look(0, -45, 30);
await look(10, 0, 22);
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/7-vista.png` });

// --- 触屏操控(独立移动端页面):UI 就位 / 摇杆行走 / 拖动视角 / 按钮跳跃与挖掘 ---
const mob = await browser.newPage({
  viewport: { width: 812, height: 375 },
  hasTouch: true,
  isMobile: true,
});
mob.on('console', (m) => m.type() === 'error' && errors.push('[触屏] ' + m.text()));
mob.on('pageerror', (e) => errors.push('[触屏] ' + String(e)));
await mob.goto('http://localhost:5173/?test', { waitUntil: 'load' });
await mob.evaluate(() => localStorage.clear());
await mob.reload({ waitUntil: 'load' });
await mob.waitForSelector('canvas.game', { timeout: 15000 });
await mob.waitForTimeout(2500);
const touchUI = (await mob.$('#joy-base')) !== null;
await mob.screenshot({ path: `${OUT}/12-touch-ui.png` });
// 摇杆前推 1.3s
const joyBox = await (await mob.$('#joy-base')).boundingBox();
const jcx = joyBox.x + joyBox.width / 2;
const jcy = joyBox.y + joyBox.height / 2;
const tp0 = await mob.evaluate(() => {
  const p = window.__game.player.pos;
  return [p.x, p.z];
});
await mob.mouse.move(jcx, jcy);
await mob.mouse.down();
await mob.mouse.move(jcx, jcy - 45, { steps: 4 });
await mob.waitForTimeout(1300);
await mob.mouse.up();
const tp1 = await mob.evaluate(() => {
  const p = window.__game.player.pos;
  return [p.x, p.z];
});
const tMoved = Math.hypot(tp1[0] - tp0[0], tp1[1] - tp0[1]);
// 右侧拖动转视角
const yaw0 = await mob.evaluate(() => window.__game.player.yaw);
await mob.mouse.move(560, 140);
await mob.mouse.down();
await mob.mouse.move(660, 140, { steps: 8 });
await mob.mouse.up();
await mob.waitForTimeout(200);
const yaw1 = await mob.evaluate(() => window.__game.player.yaw);
// 跳跃按钮
const jbBox = await (await mob.$('#btn-jump')).boundingBox();
const ty0 = await mob.evaluate(() => window.__game.player.pos.y);
await mob.mouse.move(jbBox.x + jbBox.width / 2, jbBox.y + jbBox.height / 2);
await mob.mouse.down();
await mob.waitForTimeout(170);
const ty1 = await mob.evaluate(() => window.__game.player.pos.y);
await mob.mouse.up();
await mob.waitForTimeout(600);
// 挖掘按钮:对齐所站方块、垂直俯视、长按挖掉脚下第一格
await mob.evaluate(() => {
  const g = window.__game;
  const p = g.player;
  const x = Math.floor(p.pos.x);
  const z = Math.floor(p.pos.z);
  let y = Math.floor(p.pos.y);
  while (y > 1 && !g.world.isSolid(x, y - 1, z)) y--;
  p.pos.set(x + 0.5, y + 0.01, z + 0.5);
  p.vel.set(0, 0, 0);
  p.pitch = -1.55;
});
await mob.waitForTimeout(150);
const digTarget = await mob.evaluate(() => {
  const g = window.__game;
  const p = g.player.pos;
  return [Math.floor(p.x), Math.floor(p.y - 0.5), Math.floor(p.z)];
});
const mbBox = await (await mob.$('#btn-mine')).boundingBox();
await mob.mouse.move(mbBox.x + mbBox.width / 2, mbBox.y + mbBox.height / 2);
await mob.mouse.down();
await mob.waitForTimeout(1100); // 草方块 0.45s,留足裕量
await mob.mouse.up();
const tDug = await mob.evaluate(
  ([x, y, z]) => window.__game.world.getBlock(x, y, z) === 0,
  digTarget,
);
await mob.close();
check(
  '触屏操控',
  touchUI && tMoved > 2 && Math.abs(yaw1 - yaw0) > 0.15 && ty1 > ty0 + 0.3 && tDug,
  `UI ${touchUI},摇杆移动 ${tMoved.toFixed(1)} 格,视角 Δ${Math.abs(yaw1 - yaw0).toFixed(2)},跳起 +${(ty1 - ty0).toFixed(2)} 格,挖掉脚下 ${tDug}`,
);

check('无控制台错误', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ✗`);
process.exit(failed === 0 ? 0 : 1);
