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

// --- 放置:跳跃垫块两次(圆石,左键点按放置) ---
await page.keyboard.press('Digit4');
await page.waitForTimeout(120);
for (let i = 0; i < 2; i++) {
  await page.keyboard.down('Space');
  await page.waitForTimeout(120);
  await page.keyboard.up('Space');
  await page.waitForTimeout(160); // 接近跳跃顶点
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
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

// --- 左键点按 = 放置(基岩版式交互;长按才是挖掘) ---
await page.evaluate(() => {
  const g = window.__game;
  g.mobs.setAutoSpawn(false); // 防游荡生物吃掉点按
  g.mobs.clear();
  const s = g.spawn;
  const x = Math.floor(s.x) - 5;
  const z = Math.floor(s.z) + 2;
  const h = g.world.gen.heightAt(x, z);
  g.player.pos.set(x + 0.5, h + 1.01, z + 0.5);
  g.player.vel.set(0, 0, 0);
  g.player.yaw = 0;
  g.player.pitch = -0.65;
});
await page.keyboard.press('Digit9'); // 玻璃(自然界不存在,便于断言)
await page.waitForTimeout(200);
await page.mouse.down();
await page.waitForTimeout(70);
await page.mouse.up();
await page.waitForTimeout(250);
const tapPlaced = await page.evaluate(() => {
  const g = window.__game;
  const p = g.player.pos;
  for (let dy = 1; dy >= -2; dy--) {
    for (let dx = -4; dx <= 4; dx++) {
      for (let dz = -4; dz <= 4; dz++) {
        const id = g.world.getBlock(
          Math.floor(p.x) + dx,
          Math.floor(p.y) + dy,
          Math.floor(p.z) + dz,
        );
        if (id === 12) return true;
      }
    }
  }
  return false;
});
check('左键点按放置', tapPlaced, `70ms 轻点后世界中出现玻璃 ${tapPlaced}`);

// --- 镐子:挖石类 3 倍速(徒手 0.7s 挖不动石头,镐子 0.7s 挖掉) ---
await page.evaluate(() => {
  const g = window.__game;
  const s = g.spawn;
  const x = Math.floor(s.x) - 5;
  const z = Math.floor(s.z) + 6;
  const h = g.world.gen.heightAt(x, z);
  g.player.pos.set(x + 0.5, h + 1.01, z + 0.5);
  g.player.vel.set(0, 0, 0);
  g.player.yaw = 0;
  g.player.pitch = -0.65;
});
await page.keyboard.press('Digit3'); // 石头
await page.waitForTimeout(200);
await page.mouse.down(); // 点按放一块石头
await page.waitForTimeout(60);
await page.mouse.up();
await page.waitForTimeout(250);
const stoneAt = await page.evaluate(() => {
  const g = window.__game;
  const p = g.player.pos;
  for (let dy = 2; dy >= 0; dy--) {
    for (let dx = -4; dx <= 4; dx++) {
      for (let dz = -4; dz <= 4; dz++) {
        const x = Math.floor(p.x) + dx;
        const y = Math.floor(p.y) + dy;
        const z = Math.floor(p.z) + dz;
        if (g.world.getBlock(x, y, z) === 3) return { x, y, z };
      }
    }
  }
  return null;
});
let pickOk = false;
if (stoneAt) {
  await page.mouse.down(); // 徒手 0.7s(石头硬度 1.2s,应挖不动)
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForTimeout(150);
  const handIntact = (await blockAt(stoneAt.x, stoneAt.y, stoneAt.z)) === 3;
  await page.keyboard.press('Digit7'); // 背包取镐子到槽位 7
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(250);
  await page.click('#inv-grid .inv-slot[title="镐子"]');
  await page.waitForTimeout(250);
  // page.click 的鼠标移动会转动视角(软锁),重新对准石头
  await page.evaluate(() => {
    const g = window.__game;
    g.player.yaw = 0;
    g.player.pitch = -0.65;
  });
  await page.waitForTimeout(120);
  await page.mouse.down(); // 镐子 0.7s(3 倍速 → 0.4s 即碎)
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForTimeout(150);
  const pickBroke = (await blockAt(stoneAt.x, stoneAt.y, stoneAt.z)) === 0;
  pickOk = handIntact && pickBroke;
  check('镐子挖石加速', pickOk, `徒手 0.7s 未挖动 ${handIntact},镐子 0.7s 挖掉 ${pickBroke}`);
} else {
  check('镐子挖石加速', false, '未能放置石头');
}
await page.keyboard.press('Digit1');

// --- 南瓜朝向:四个视角各放一个,脸各自转向玩家(四种变体齐全) ---
await page.evaluate(() => {
  const g = window.__game;
  const s = g.spawn;
  const x = Math.floor(s.x) + 6;
  const z = Math.floor(s.z) + 6;
  g.player.pos.set(x + 0.5, g.world.gen.heightAt(x, z) + 1.01, z + 0.5);
  g.player.vel.set(0, 0, 0);
});
await page.keyboard.press('Digit5'); // 槽位 5,从背包取南瓜
await page.keyboard.press('KeyE');
await page.waitForTimeout(250);
await page.click('#inv-grid .inv-slot[title="南瓜"]');
await page.waitForTimeout(250);
for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
  await page.evaluate((y) => {
    const g = window.__game;
    g.player.yaw = y;
    g.player.pitch = -0.7;
    g.player.vel.set(0, 0, 0);
  }, yaw);
  await page.waitForTimeout(150);
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(200);
}
const pumpkinIds = await page.evaluate(() => {
  const g = window.__game;
  const p = g.player.pos;
  const found = new Set();
  for (let dy = 1; dy >= -2; dy--) {
    for (let dx = -4; dx <= 4; dx++) {
      for (let dz = -4; dz <= 4; dz++) {
        const id = g.world.getBlock(
          Math.floor(p.x) + dx,
          Math.floor(p.y) + dy,
          Math.floor(p.z) + dz,
        );
        if (id === 26 || id === 30 || id === 31 || id === 32) found.add(id);
      }
    }
  }
  return [...found].sort((a, b) => a - b);
});
check(
  '南瓜放置朝向',
  pumpkinIds.join(',') === '26,30,31,32',
  `四向放置得到变体 [${pumpkinIds.join(',')}](应为 26,30,31,32)`,
);
await page.keyboard.press('Digit1');

// --- 背包:E 打开,点选砖块放入当前槽位,再放置到世界 ---
await page.keyboard.press('Digit5'); // 选中槽位 5(默认木板)
await page.waitForTimeout(120);
await page.keyboard.press('KeyE');
await page.waitForTimeout(250);
const invOpen = await page.evaluate(() =>
  document.getElementById('inventory').classList.contains('open'),
);
await page.screenshot({ path: `${OUT}/9-inventory.png` });
const toolIconStyle = await page.evaluate(() => {
  const pixels = (title) => {
    const slot = [...document.querySelectorAll('#inv-grid .inv-slot')].find(
      (el) => el.getAttribute('title') === title,
    );
    const canvas = slot?.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    return {
      data: canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data,
      width: canvas.width,
      height: canvas.height,
    };
  };
  const count = (img, pred, region = () => true) => {
    if (!img) return 0;
    let n = 0;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const i = (y * img.width + x) * 4;
        if (img.data[i + 3] > 120 && region(x, y) && pred(img.data[i], img.data[i + 1], img.data[i + 2])) n++;
      }
    }
    return n;
  };
  const iron = (r, g, b) => r > 120 && g > 120 && b > 120 && Math.abs(r - g) < 32 && Math.abs(g - b) < 32;
  const wood = (r, g, b) => r > 75 && r > g + 18 && g > b + 10;
  const sword = pixels('剑');
  const pick = pixels('镐子');
  return {
    swordIron: count(sword, iron),
    swordGuard: count(sword, (r, g, b) => r > 65 && r < 150 && Math.abs(r - g) < 18 && Math.abs(g - b) < 24, (x, y) => x < 24 && y > 20),
    swordWood: count(sword, wood, (x, y) => x < 18 && y > 32),
    pickIron: count(pick, iron),
    // 斜向镐头:金属需同时出现在左上(左尖)与右下(右尖),证明镐头是斜的而非横平。
    pickHeadUpLeft: count(pick, iron, (x, y) => x < 27 && y < 15),
    pickTipDownRight: count(pick, iron, (x, y) => x > 30 && y > 18),
    pickWood: count(pick, wood, (x, y) => x < 24 && y > 24),
  };
});
check(
  '工具图标 MC 风格',
  toolIconStyle.swordIron > 120 &&
    toolIconStyle.swordGuard > 35 &&
    toolIconStyle.swordWood > 20 &&
    toolIconStyle.pickIron > 170 &&
    toolIconStyle.pickHeadUpLeft > 60 &&
    toolIconStyle.pickTipDownRight > 28 &&
    toolIconStyle.pickWood > 45,
  `铁剑刃/护手/木柄 ${toolIconStyle.swordIron}/${toolIconStyle.swordGuard}/${toolIconStyle.swordWood},斜镐头/左上头/右下尖/木柄 ${toolIconStyle.pickIron}/${toolIconStyle.pickHeadUpLeft}/${toolIconStyle.pickTipDownRight}/${toolIconStyle.pickWood}`,
);
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
await page.mouse.down();
await page.waitForTimeout(60);
await page.mouse.up();
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

// --- 剑:双倍伤害,一剑 hp 3→1,两剑毙命 ---
await page.keyboard.press('Digit8'); // 背包取剑到槽位 8
await page.keyboard.press('KeyE');
await page.waitForTimeout(250);
await page.click('#inv-grid .inv-slot[title="剑"]');
await page.waitForTimeout(250);
await page.evaluate(() => {
  const g = window.__game;
  const s = g.spawn;
  const x = Math.floor(s.x) + 3;
  const z = Math.floor(s.z) + 1;
  const h = g.world.gen.heightAt(x, z);
  g.mobs.spawnAt(x + 0.5, h + 1.01, z + 0.5);
});
let swordHits = 0;
let hpAfterOne = -1;
while (swordHits < 5 && (await page.evaluate(() => window.__game.mobs.count())) > 0) {
  await page.evaluate(() => {
    const g = window.__game;
    const list = g.mobs.list();
    if (!list.length) return;
    const m = list[0];
    g.player.pos.set(m.x - 2, m.y, m.z);
    g.player.vel.set(0, 0, 0);
    g.player.yaw = Math.atan2(-(m.x - (m.x - 2)), 0);
    g.player.pitch = -0.42;
  });
  await page.waitForTimeout(150);
  await page.mouse.down();
  await page.mouse.up();
  swordHits++;
  if (swordHits === 1) {
    await page.waitForTimeout(150);
    hpAfterOne = await page.evaluate(() => window.__game.mobs.list()[0]?.hp ?? 0);
  }
  await page.waitForTimeout(400);
}
check(
  '剑:双倍伤害',
  hpAfterOne <= 1 && swordHits <= 3,
  `一剑后 hp=${hpAfterOne}(应 ≤1),${swordHits} 剑毙命(徒手需 3+)`,
);

// --- 剑不能挖掘(与 MC 一致):手持剑对草方块长按 1s,方块仍在 ---
await page.evaluate(() => {
  const g = window.__game;
  const p = g.player;
  const x = Math.floor(p.pos.x);
  const z = Math.floor(p.pos.z);
  let y = Math.floor(p.pos.y);
  while (y > 1 && !g.world.isSolid(x, y - 1, z)) y--;
  p.pos.set(x + 0.5, y + 0.01, z + 0.5);
  p.vel.set(0, 0, 0);
  p.pitch = -1.55; // 俯视脚下
});
await page.waitForTimeout(200);
const swordDigTarget = await page.evaluate(() => {
  const g = window.__game;
  const p = g.player.pos;
  return [Math.floor(p.x), Math.floor(p.y - 0.5), Math.floor(p.z)];
});
await page.mouse.down(); // 手持剑(槽位 8)长按 1s
await page.waitForTimeout(1000);
await page.mouse.up();
await page.waitForTimeout(150);
const swordNoDig = await page.evaluate(
  ([x, y, z]) => window.__game.world.getBlock(x, y, z) !== 0,
  swordDigTarget,
);
check('剑不能挖掘', swordNoDig, `长按 1s 后脚下方块仍在 ${swordNoDig}(徒手 0.45s 即可挖掉)`);
await page.keyboard.press('Digit1');

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
await page.mouse.down(); // 点按放置
await page.waitForTimeout(60);
await page.mouse.up();
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
  const countTnt = () =>
    page.evaluate(({ x, y, z }) => {
      const g = window.__game;
      let n = 0;
      for (let dx = -3; dx <= 3; dx++) {
        for (let dy = -2; dy <= 3; dy++) {
          for (let dz = -3; dz <= 3; dz++) {
            if (g.world.getBlock(x + dx, y + dy, z + dz) === 17) n++;
          }
        }
      }
      return n;
    }, tntPos);
  // 手持 TNT 再点按同一处:应堆叠出第二个 TNT 而不是点燃
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(250);
  const stacked = await countTnt();
  check('TNT 堆叠(不再点按即燃)', stacked === 2, `连点两次后场上 TNT=${stacked}(应为 2)`);

  // 换打火石点燃:背包取打火石到槽位 6
  await page.keyboard.press('Digit6');
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(250);
  await page.click('#inv-grid .inv-slot[title="打火石"]');
  await page.waitForTimeout(250);
  // 重新对准(page.click 的鼠标移动会转动视角)
  await page.evaluate(() => {
    const g = window.__game;
    g.player.yaw = 0;
    g.player.pitch = -0.65;
  });
  await page.waitForTimeout(120);
  const groundBefore = await blockAt(tntPos.x, tntPos.y - 1, tntPos.z);
  await page.mouse.down(); // 打火石点按点燃
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(700);
  const afterIgnite = await countTnt(); // 被点燃的那个变为闪烁实体
  await page.screenshot({ path: `${OUT}/5a-tnt-primed.png` });
  await page.waitForTimeout(2600); // 等引信 + 连锁爆炸
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
    '打火石点燃 TNT 成坑',
    afterIgnite === 1 && groundBefore !== 0 && groundAfter === 0 && crater > 60,
    `点燃后场上 TNT ${stacked}→${afterIgnite},地面 ${groundBefore}→${groundAfter},5³ 空洞 ${crater}/125`,
  );
  await page.screenshot({ path: `${OUT}/5a-tnt-crater.png` });
} else {
  check('TNT 堆叠(不再点按即燃)', false, '未能放置 TNT');
  check('打火石点燃 TNT 成坑', false, '未能放置 TNT');
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
await page.keyboard.press('Digit6'); // 槽位 6 已放打火石
await page.waitForTimeout(120);
await page.mouse.down(); // 打火石点燃
await page.waitForTimeout(60);
await page.mouse.up();
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
  const SEA = 128;
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
  await page.evaluate(({ bx, bz }) => window.__game.world.setBlock(bx, 128, bz, 0), shore);
  await page.waitForTimeout(2200); // 等待水流 tick
  const filled = await page.evaluate(
    ({ bx, bz }) => {
      const id = window.__game.world.getBlock(bx, 128, bz);
      return { id, isWater: id === 10 || (id >= 13 && id <= 16) };
    },
    shore,
  );
  check('水流涌入缺口', filled.isWater, `缺口方块 id=${filled.id}(13-16 为流水)`);
  await page.screenshot({ path: `${OUT}/5b-water-flow.png` });
} else {
  console.log('SKIP  水流(附近没找到合适湖岸)');
}

// --- 游泳:传送进深水,按空格上浮(内陆湖不够深就去海里) ---
const water = await page.evaluate(() => {
  const g = window.__game;
  for (let r = 4; r < 380; r += 4) {
    for (let a = 0; a < 16; a++) {
      const x = Math.round(Math.cos((a / 16) * Math.PI * 2) * r);
      const z = Math.round(Math.sin((a / 16) * Math.PI * 2) * r);
      if (g.world.gen.heightAt(x, z) <= 128 - 3) return { x, z };
    }
  }
  return null;
});
if (water) {
  await page.evaluate(({ x, z }) => {
    const g = window.__game;
    g.world.warmup(Math.floor(x / 16), Math.floor(z / 16));
    g.player.pos.set(x + 0.5, 126, z + 0.5);
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
  const SEA = 128;
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
    g.player.pos.set(ax + 0.5, 128.2, az + 0.5);
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
    wet && !after.wet && after.y >= 128.9,
    `入水 ${wet} → 出水 ${!after.wet},最终高度 y=${after.y.toFixed(2)}(岸面 129)`,
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
  g.player.pos.set(g.spawn.x, 1, g.spawn.z); // 卡进地底深处(地狱底部石层)
  g.player.vel.set(0, 0, 0);
  g.save();
});
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('canvas.game', { timeout: 15000 });
await page.waitForTimeout(2000);
const rescued = await page.evaluate(() => {
  const g = window.__game;
  const p = g.player.pos;
  return {
    y: p.y,
    spawnY: g.spawn.y,
    // 出生点可能被前面的 TNT 测试炸出坑,只断言"脱离地底、回到出生点水平位置"
    nearXZ: Math.hypot(p.x - g.spawn.x, p.z - g.spawn.z) < 2.5,
  };
});
check(
  '地底坏存档自救',
  rescued.y > 100 && rescued.nearXZ,
  `读档位置 y=${rescued.y.toFixed(1)}(卡死点 y=1,出生点 y=${rescued.spawnY.toFixed(1)},水平回位 ${rescued.nearXZ})`,
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

// --- 火把与萤石:夜里放置照亮周围,挖掉光照归零 ---
await page.evaluate(() => {
  const g = window.__game;
  const s = g.spawn;
  const x = Math.floor(s.x) + 7;
  const z = Math.floor(s.z) - 6;
  const h = g.world.gen.heightAt(x, z);
  g.player.pos.set(x + 0.5, h + 1.01, z + 0.5);
  g.player.vel.set(0, 0, 0);
  g.player.yaw = 0;
  g.player.pitch = -0.65;
  g.setTime(0.75); // 午夜
});
await page.keyboard.press('Digit5');
await page.keyboard.press('KeyE');
await page.waitForTimeout(250);
await page.click('#inv-grid .inv-slot[title="火把"]');
await page.waitForTimeout(250);
const lightBaseline = await page.evaluate(() => {
  const g = window.__game;
  g.player.yaw = 0;
  g.player.pitch = -0.65;
  // 基线光源数:地标(世界树/地牢/遗迹)的生成萤石随区块加载登记
  return g.world.lights.sourceCount;
});
await page.waitForTimeout(120);
await page.mouse.down(); // 点按放火把
await page.waitForTimeout(60);
await page.mouse.up();
await page.waitForTimeout(300);
const torchInfo = await page.evaluate(() => {
  const g = window.__game;
  const p = g.player.pos;
  for (let dy = 1; dy >= -1; dy--) {
    for (let dx = -4; dx <= 4; dx++) {
      for (let dz = -4; dz <= 4; dz++) {
        const x = Math.floor(p.x) + dx;
        const y = Math.floor(p.y) + dy;
        const z = Math.floor(p.z) + dz;
        if (g.world.getBlock(x, y, z) === 33) {
          return {
            src: g.world.lights.lightAt(x, y, z),
            near: g.world.lights.lightAt(x + 1, y, z),
            sources: g.world.lights.sourceCount,
            x, y, z,
          };
        }
      }
    }
  }
  return null;
});
await page.screenshot({ path: `${OUT}/18-torch-night.png` });
let torchOk = false;
if (torchInfo) {
  // 挖掉火把(硬度 0.1,长按 0.5s)
  await page.mouse.down();
  await page.waitForTimeout(500);
  await page.mouse.up();
  await page.waitForTimeout(250);
  const after = await page.evaluate(
    ([x, y, z]) => ({
      block: window.__game.world.getBlock(x, y, z),
      light: window.__game.world.lights.lightAt(x, y, z),
      sources: window.__game.world.lights.sourceCount,
    }),
    [torchInfo.x, torchInfo.y, torchInfo.z],
  );
  torchOk =
    torchInfo.src === 14 && torchInfo.near === 13 && torchInfo.sources === lightBaseline + 1 &&
    after.block === 0 && after.light === 0 && after.sources === lightBaseline;
  check(
    '火把:夜间光照与挖除',
    torchOk,
    `放置后源=${torchInfo.src} 邻=${torchInfo.near} 光源数=${torchInfo.sources}(基线 ${lightBaseline}+1);挖除后 方块=${after.block} 光=${after.light} 光源数=${after.sources}`,
  );
} else {
  check('火把:夜间光照与挖除', false, '未能放置火把');
}
await page.evaluate(() => window.__game.setTime(0.25));
await page.keyboard.press('Digit1');
await page.waitForTimeout(200);

// --- 方块物理:沙子失去支撑坠落;火把被水冲走 ---
const physInfo = await page.evaluate(() => {
  const g = window.__game;
  const s = g.spawn;
  const x = Math.floor(s.x) + 9;
  const z = Math.floor(s.z) + 3;
  const h = g.world.gen.heightAt(x, z);
  // 石柱托一块沙,然后抽掉石柱
  g.world.setBlock(x, h + 1, z, 3);
  g.world.setBlock(x, h + 2, z, 4);
  g.world.setBlock(x, h + 1, z, 0);
  return { x, z, h };
});
await page.waitForTimeout(900); // 等沙落定
const sandFell = await page.evaluate(
  ({ x, z, h }) => ({
    landed: window.__game.world.getBlock(x, h + 1, z) === 4,
    origin: window.__game.world.getBlock(x, h + 2, z) === 0,
  }),
  physInfo,
);
const torchWash = await page.evaluate(() => {
  const g = window.__game;
  const s = g.spawn;
  const x = Math.floor(s.x) + 9;
  const z = Math.floor(s.z) + 6;
  const h = g.world.gen.heightAt(x, z);
  g.world.setBlock(x, h + 1, z, 33); // 火把
  g.world.setBlock(x + 1, h + 1, z, 10); // 旁边放水源
  return { x, z, h, drops0: g.drops.count };
});
await page.waitForTimeout(1500); // 等水流 tick
const washResult = await page.evaluate(
  ({ x, z, h, drops0 }) => {
    const g = window.__game;
    g.world.setBlock(x + 1, h + 1, z, 0); // 清理水源
    return {
      gone: g.world.getBlock(x, h + 1, z) !== 33,
      dropped: g.drops.count > drops0,
    };
  },
  torchWash,
);
check(
  '方块物理:沙落与水冲火把',
  sandFell.landed && sandFell.origin && washResult.gone && washResult.dropped,
  `沙落地 ${sandFell.landed} 原位空 ${sandFell.origin};火把被冲走 ${washResult.gone} 掉落物 ${washResult.dropped}`,
);

// --- 僵尸:夜间追击攻击玩家,白天燃烧;玩家死亡重生 ---
await page.evaluate(() => {
  const g = window.__game;
  g.mobs.setAutoSpawn(false);
  g.mobs.clear();
  g.setTime(0.75); // 午夜
  g.setHp(10);
  const s = g.spawn;
  const x = Math.floor(s.x);
  const z = Math.floor(s.z);
  const h = g.world.gen.heightAt(x, z);
  g.player.pos.set(x + 0.5, h + 1.01, z + 0.5);
  g.player.vel.set(0, 0, 0);
  g.player.yaw = 0;
  g.player.pitch = -0.1;
  // 僵尸生成在 6 格外,验证追击
  g.mobs.spawnAt(x + 0.5, g.world.gen.heightAt(x, z - 6) + 1.01, z - 6 + 0.5, 'zombie');
});
await page.waitForTimeout(400);
const z0 = await page.evaluate(() => {
  const g = window.__game;
  const m = g.mobs.list()[0];
  const p = g.player.pos;
  return { kind: m.kind, dist: Math.hypot(m.x - p.x, m.z - p.z), hp: g.hp() };
});
await page.screenshot({ path: `${OUT}/19-zombie.png` });
await page.waitForTimeout(3200); // 等它追过来打人
const z1 = await page.evaluate(() => {
  const g = window.__game;
  const m = g.mobs.list()[0];
  const p = g.player.pos;
  return { dist: m ? Math.hypot(m.x - p.x, m.z - p.z) : 99, hp: g.hp() };
});
check(
  '僵尸:夜间追击并攻击',
  z0.kind === 'zombie' && z1.dist < z0.dist - 1 && z1.hp < z0.hp,
  `距离 ${z0.dist.toFixed(1)}→${z1.dist.toFixed(1)},玩家 HP ${z0.hp}→${z1.hp}`,
);

// 玩家被打死 → 死亡计数 +1、血量重置回满(僵尸可能继续追打/击退)
const deaths0 = await page.evaluate(() => window.__game.deaths());
await page.evaluate(() => window.__game.setHp(2));
await page.waitForTimeout(2500); // 挨一下(-2)即死
const respawned = await page.evaluate(() => {
  const g = window.__game;
  g.mobs.clear(); // 先清场,防继续挨打干扰后续断言
  const p = g.player.pos;
  return {
    hp: g.hp(),
    deaths: g.deaths(),
    nearSpawn: Math.hypot(p.x - g.spawn.x, p.z - g.spawn.z) < 9,
  };
});
check(
  '玩家死亡重生',
  respawned.deaths === deaths0 + 1 && respawned.hp >= 6 && respawned.nearSpawn,
  `死亡次数 ${deaths0}→${respawned.deaths},重生后 HP=${respawned.hp},出生点附近(±9,含击退) ${respawned.nearSpawn}`,
);

// 白天:新生成的僵尸燃烧消亡
await page.evaluate(() => {
  const g = window.__game;
  g.setTime(0.25); // 正午
  const s = g.spawn;
  const x = Math.floor(s.x) + 5;
  const z = Math.floor(s.z) + 5;
  g.mobs.spawnAt(x + 0.5, g.world.gen.heightAt(x, z) + 1.01, z + 0.5, 'zombie');
});
const burn0 = await page.evaluate(() => window.__game.mobs.count());
await page.waitForTimeout(5200); // 5 血 × 0.8s/血 = 4s
const burned = await page.evaluate(() => window.__game.mobs.count());
check('僵尸:白天燃烧消亡', burn0 === 1 && burned === 0, `正午生成 ${burn0} 只,5s 后剩 ${burned}(应烧光)`);
await page.evaluate(() => {
  window.__game.mobs.setAutoSpawn(true);
  window.__game.setHp(10);
});

// --- 长按 T:时间连续快进(替代原先的跳跃式) ---
const tHold0 = await page.evaluate(() => window.__game.env().time);
await page.keyboard.down('KeyT');
await page.waitForTimeout(600);
await page.keyboard.up('KeyT');
const tHold1 = await page.evaluate(() => window.__game.env().time);
const tHoldDelta = (((tHold1 - tHold0) % 1) + 1) % 1;
check(
  '长按 T 加速时间',
  tHoldDelta > 0.04 && tHoldDelta < 0.2,
  `按住 600ms 推进 ${tHoldDelta.toFixed(3)} 天(常速仅 ~0.001)`,
);
await page.evaluate(() => window.__game.setTime(0.25));
await page.waitForTimeout(200);

// --- F5 第三人称:模型可见,行走摆腿截图,再切回第一人称 ---
const v0 = await page.evaluate(() => ({
  view: window.__game.view(),
  model: window.__game.modelVisible(),
}));
await page.keyboard.press('F5');
await page.waitForTimeout(200);
const v1 = await page.evaluate(() => ({
  view: window.__game.view(),
  model: window.__game.modelVisible(),
}));
await page.evaluate(() => {
  const g = window.__game;
  const s = g.spawn;
  g.player.pos.set(s.x, s.y + 0.01, s.z);
  g.player.vel.set(0, 0, 0);
  g.player.yaw = 0;
  g.player.pitch = -0.25;
});
await page.keyboard.down('KeyW');
await page.waitForTimeout(450); // 行走中抓拍摆腿
await page.screenshot({ path: `${OUT}/16-third-person.png` });
await page.keyboard.up('KeyW');
await page.waitForTimeout(200);
// 第三人称细节:准星保留在屏幕中央、手持物跟随槽位、-/= 缩放
const tpDetail = await page.evaluate(() => ({
  crosshairVisible: document.getElementById('crosshair').style.display !== 'none',
  held: window.__game.heldId(),
}));
await page.keyboard.press('Digit3'); // 石头
await page.waitForTimeout(150);
const heldStone = await page.evaluate(() => window.__game.heldId());
// 现场装剑(清档测试重置过快捷栏),装完重新对准
await page.keyboard.press('Digit8');
await page.keyboard.press('KeyE');
await page.waitForTimeout(250);
await page.click('#inv-grid .inv-slot[title="剑"]');
await page.waitForTimeout(250);
await page.evaluate(() => {
  const g = window.__game;
  g.player.yaw = 0;
  g.player.pitch = -0.15;
});
await page.waitForTimeout(150);
const heldSword = await page.evaluate(() => window.__game.heldId());
await page.keyboard.press('Minus');
await page.keyboard.press('Minus');
await page.waitForTimeout(120);
await page.screenshot({ path: `${OUT}/16b-third-person-sword.png` });
await page.keyboard.press('Digit1');
await page.keyboard.press('F5');
await page.waitForTimeout(200);
const v2 = await page.evaluate(() => ({
  view: window.__game.view(),
  model: window.__game.modelVisible(),
  crosshair: document.getElementById('crosshair').style.display !== 'none',
  held: window.__game.heldId(),
}));
check(
  'F5 第三人称视角',
  v0.view === 0 && !v0.model && v1.view === 1 && v1.model && v2.view === 0 && !v2.model,
  `视角 ${v0.view}→${v1.view}→${v2.view},模型可见 ${v0.model}→${v1.model}→${v2.model}`,
);
check(
  '第三人称:准星保留与手持物',
  tpDetail.crosshairVisible && heldStone === 3 && heldSword === 102 && v2.crosshair && v2.held === -1,
  `第三人称准星可见 ${tpDetail.crosshairVisible},手持 石头=${heldStone} 剑=${heldSword},切回后手持清空 ${v2.held === -1}`,
);

// --- Terraria 3D:空气墙(有限世界边界)与结构化地形 ---
await page.evaluate(() => {
  const g = window.__game;
  g.mobs.setAutoSpawn(false);
  g.mobs.clear();
  // 传送到边界内 3 格的海面上,面朝正外(+x)
  g.player.pos.set(617, 130, 0);
  g.player.vel.set(0, 0, 0);
  g.player.yaw = -Math.PI / 2;
  g.player.pitch = 0;
});
await page.waitForTimeout(800);
await page.keyboard.down('KeyW');
await page.waitForTimeout(2000); // 向外游 2s,应被空气墙拦住
await page.keyboard.up('KeyW');
const wallDist = await page.evaluate(() => {
  const p = window.__game.player.pos;
  return Math.hypot(p.x, p.z);
});
// 越墙放置应被拒绝(准星指向墙外海面)
await page.keyboard.press('Digit4');
await page.evaluate(() => {
  const g = window.__game;
  g.player.yaw = -Math.PI / 2;
  g.player.pitch = -0.5;
});
await page.mouse.down();
await page.waitForTimeout(70);
await page.mouse.up();
await page.waitForTimeout(200);
const wallOut = await page.evaluate(() => {
  const g = window.__game;
  let placed = 0;
  for (let dx = 0; dx <= 8; dx++) {
    for (let dy = -4; dy <= 2; dy++) {
      if (g.world.getBlock(620 + dx, 130 + dy, 0) === 8) placed++;
    }
  }
  return placed;
});
check(
  '空气墙:有限世界边界',
  wallDist <= 620.01 && wallOut === 0,
  `向外冲 2s 后距中心 ${wallDist.toFixed(1)}(墙 620),墙外圆石 ${wallOut} 块`,
);
await page.screenshot({ path: `${OUT}/20-ocean-edge.png` });
// 山脉带远景
await page.evaluate(() => {
  const g = window.__game;
  g.world.warmup(0, Math.floor(-120 / 16));
  const h = g.world.gen.heightAt(0, -120);
  g.player.pos.set(0.5, Math.max(h + 1.01, 131), -119.5);
  g.player.vel.set(0, 0, 0);
  g.player.yaw = 0; // 面向 -z(山脉带方向)
  g.player.pitch = 0.08;
});
await page.waitForTimeout(1500); // 等区块网格化
await page.screenshot({ path: `${OUT}/20b-mountain-range.png` });
await page.evaluate(() => {
  const g = window.__game;
  g.world.warmup(Math.floor(g.spawn.x / 16), Math.floor(g.spawn.z / 16));
  g.player.pos.set(g.spawn.x, g.spawn.y + 1, g.spawn.z);
  g.player.vel.set(0, 0, 0);
  g.mobs.setAutoSpawn(true);
});
await page.waitForTimeout(600);

// --- Terraria 3D · Phase 3:生物群系(丛林/腐化/深谷/河流) ---
const biomeSpots = await page.evaluate(() => {
  const g = window.__game;
  const find = (biome, a0, a1) => {
    for (let a = a0; a < a1; a += 0.05) {
      for (let d = 250; d < 335; d += 8) {
        const x = Math.round(Math.cos(a) * d);
        const z = Math.round(Math.sin(a) * d);
        if (g.world.gen.biomeAt(x, z) === biome && g.world.gen.heightAt(x, z) > 130) {
          return { x, z };
        }
      }
    }
    return null;
  };
  return { jungle: find('jungle', 0.85, 1.6), corruption: find('corruption', 3.45, 4.0) };
});
if (biomeSpots.jungle) {
  await page.evaluate(({ x, z }) => {
    const g = window.__game;
    g.world.warmup(Math.floor(x / 16), Math.floor(z / 16));
    g.player.pos.set(x + 0.5, g.world.gen.heightAt(x, z) + 1.01, z + 0.5);
    g.player.vel.set(0, 0, 0);
    g.player.yaw = Math.PI / 3;
    g.player.pitch = 0.05;
  }, biomeSpots.jungle);
  await page.waitForTimeout(1600);
  const jungleHud = await page.evaluate(() => ({
    biome: window.__game.biome(),
    meter: document.getElementById('depth-meter').textContent,
  }));
  await page.screenshot({ path: `${OUT}/22-jungle.png` });
  check(
    '群系:丛林',
    jungleHud.biome === 'jungle' && jungleHud.meter.includes('丛林'),
    `biome=${jungleHud.biome},深度计 "${jungleHud.meter}"`,
  );
} else {
  check('群系:丛林', false, '未找到丛林陆地');
}
if (biomeSpots.corruption) {
  await page.evaluate(({ x, z }) => {
    const g = window.__game;
    g.world.warmup(Math.floor(x / 16), Math.floor(z / 16));
    g.player.pos.set(x + 0.5, g.world.gen.heightAt(x, z) + 1.01, z + 0.5);
    g.player.vel.set(0, 0, 0);
    g.player.yaw = -Math.PI / 4;
    g.player.pitch = 0.02;
  }, biomeSpots.corruption);
  await page.waitForTimeout(1600);
  const corruptHud = await page.evaluate(() => ({
    biome: window.__game.biome(),
    meter: document.getElementById('depth-meter').textContent,
  }));
  await page.screenshot({ path: `${OUT}/22b-corruption.png` });
  check(
    '群系:腐化之地',
    corruptHud.biome === 'corruption' && corruptHud.meter.includes('腐化'),
    `biome=${corruptHud.biome},深度计 "${corruptHud.meter}"`,
  );
} else {
  check('群系:腐化之地', false, '未找到腐化陆地');
}
// --- Terraria 3D · Phase 4:地标(世界树/天空岛/地牢)与宝箱 ---
// 世界树:外观截图 → 进树开底层宝箱
const treeInfo = await page.evaluate(() => {
  const g = window.__game;
  const t = g.structures().tree;
  // 站在树与出生点之间 22 格处,面向树看树冠
  const ang = Math.atan2(t.z, t.x);
  const px = t.x - Math.cos(ang) * 22;
  const pz = t.z - Math.sin(ang) * 22;
  g.world.warmup(Math.floor(t.x / 16), Math.floor(t.z / 16));
  g.world.warmup(Math.floor(px / 16), Math.floor(pz / 16));
  const h = g.world.gen.heightAt(Math.round(px), Math.round(pz));
  g.player.pos.set(px + 0.5, h + 1.01, pz + 0.5);
  g.player.vel.set(0, 0, 0);
  g.player.yaw = Math.atan2(-(t.x - px), -(t.z - pz));
  g.player.pitch = 0.42;
  return t;
});
await page.waitForTimeout(1800);
await page.screenshot({ path: `${OUT}/23-worldtree.png` });
const treeCheck = await page.evaluate((t) => {
  const g = window.__game;
  // 传送进树内,精确瞄准底层宝箱的中心
  g.player.pos.set(t.x + 0.5, t.ground + 1.01, t.z - 2 + 0.5);
  g.player.vel.set(0, 0, 0);
  g.player.yaw = Math.PI; // 面向 +z(宝箱在中心)
  const eyeY = t.ground + 1.01 + 1.62;
  g.player.pitch = Math.atan2(t.ground + 1.5 - eyeY, 2);
  let logs = 0;
  for (let y = t.ground; y < t.ground + 40; y += 4) {
    if (g.world.getBlock(t.x + 4, y, t.z) === 5) logs++;
  }
  return {
    logs,
    chest: g.world.getBlock(t.x, t.ground + 1, t.z) === 43,
    pickups: g.stats.pickups,
  };
}, treeInfo);
await page.waitForTimeout(300);
await page.mouse.down();
await page.waitForTimeout(70);
await page.mouse.up();
await page.waitForTimeout(1200); // 战利品磁吸拾取
const treeLoot = await page.evaluate((t) => {
  const g = window.__game;
  return {
    chestGone: g.world.getBlock(t.x, t.ground + 1, t.z) === 0,
    gained: g.stats.pickups,
    drops: g.drops.count,
  };
}, treeInfo);
check(
  '地标:世界树与开箱',
  treeCheck.logs >= 9 &&
    treeCheck.chest &&
    treeLoot.chestGone &&
    (treeLoot.gained > treeCheck.pickups || treeLoot.drops > 0),
  `树干原木 ${treeCheck.logs}/10,宝箱开出战利品:拾取 ${treeCheck.pickups}→${treeLoot.gained},场上掉落 ${treeLoot.drops}`,
);

// 天空岛:传送上岛,断言天空层/悬空/神龛宝箱
const islandCheck = await page.evaluate(() => {
  const g = window.__game;
  const isl = g.structures().islands[0];
  g.world.warmup(Math.floor(isl.x / 16), Math.floor(isl.z / 16));
  // 神龛外找一块草皮落脚
  let sx = isl.x + 3;
  for (let dx = 3; dx <= 6; dx++) {
    const id = g.world.getBlock(isl.x + dx, isl.y, isl.z);
    if (id !== 0) {
      sx = isl.x + dx;
      break;
    }
  }
  g.player.pos.set(sx + 0.5, isl.y + 1.01, isl.z + 0.5);
  g.player.vel.set(0, 0, 0);
  g.player.yaw = Math.atan2(-(isl.x - sx), 0);
  g.player.pitch = -0.12;
  return {
    isl,
    chest: g.world.getBlock(isl.x, isl.y + 1, isl.z) === 43,
    floating: g.world.getBlock(isl.x, isl.y - 16, isl.z) === 0,
  };
});
await page.waitForTimeout(1600);
const islandHud = await page.evaluate(() => ({
  meter: document.getElementById('depth-meter').textContent,
  y: window.__game.player.pos.y,
}));
await page.screenshot({ path: `${OUT}/23b-skyisland.png` });
check(
  '地标:天空岛',
  islandCheck.chest && islandCheck.floating && islandHud.meter.includes('天空层'),
  `岛(${islandCheck.isl.x},${islandCheck.isl.y},${islandCheck.isl.z}) 宝箱 ${islandCheck.chest},悬空 ${islandCheck.floating},深度计 "${islandHud.meter}"`,
);

// 地牢:塔楼外观 → 顶层房间(蓝砖迷宫,生成萤石正常发光)
const dungeonOutside = await page.evaluate(() => {
  const g = window.__game;
  const d = g.structures().dungeon;
  // 站在朝出生点一侧的塔门外
  const face = Math.abs(d.x) > Math.abs(d.z) ? [d.x > 0 ? -1 : 1, 0] : [0, d.z > 0 ? -1 : 1];
  const px = d.x + face[0] * 19;
  const pz = d.z + face[1] * 19;
  g.world.warmup(Math.floor(d.x / 16), Math.floor(d.z / 16));
  g.world.warmup(Math.floor(px / 16), Math.floor(pz / 16));
  const h = g.world.gen.heightAt(Math.round(px), Math.round(pz));
  g.player.pos.set(px + 0.5, Math.max(h, d.ground) + 1.01, pz + 0.5);
  g.player.vel.set(0, 0, 0);
  g.player.yaw = Math.atan2(-(d.x - px), -(d.z - pz));
  g.player.pitch = 0.12;
  return d;
});
await page.waitForTimeout(1600);
await page.screenshot({ path: `${OUT}/23c-dungeon.png` });
const dungeonCheck = await page.evaluate((d) => {
  const g = window.__game;
  // 顶层房间 (0,0):中心 (x-8, z-8),室内地面 y = ground-10
  const fy = d.ground - 10;
  g.player.pos.set(d.x - 6 + 0.5, fy + 0.01, d.z - 8 + 0.5);
  g.player.vel.set(0, 0, 0);
  g.player.yaw = Math.PI / 2; // 面向 -x(房间中心宝箱)
  g.player.pitch = -0.2;
  return {
    brickWall: g.world.getBlock(d.x - 12, fy, d.z - 8) === 44,
    brickSlab: g.world.getBlock(d.x - 8, fy - 1, d.z - 8) === 44,
    chest: g.world.getBlock(d.x - 8, fy, d.z - 8) === 43,
    // 光照采样宝箱上方的空气格(不透明格子光值恒 0)
    roomLight: g.world.lights.lightAt(d.x - 8, fy + 1, d.z - 8),
  };
}, dungeonOutside);
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/23d-dungeon-room.png` });
check(
  '地标:地牢迷宫',
  dungeonCheck.brickWall && dungeonCheck.brickSlab && dungeonCheck.chest && dungeonCheck.roomLight >= 4,
  `蓝砖墙/楼板 ${dungeonCheck.brickWall}/${dungeonCheck.brickSlab},房间宝箱 ${dungeonCheck.chest},萤石光照 ${dungeonCheck.roomLight}`,
);

// 地狱遗迹:视觉复核截图(结构断言由单元测试覆盖)
await page.evaluate(() => {
  const g = window.__game;
  const f = g.structures().hellForts[0];
  if (!f) return;
  g.world.warmup(Math.floor(f.x / 16), Math.floor(f.z / 16));
  g.player.pos.set(f.x + 7 + 0.5, 12.01, f.z + 0.5);
  g.player.vel.set(0, 0, 0);
  g.player.yaw = Math.PI / 2; // 面向 -x(遗迹门洞)
  g.player.pitch = 0.06;
});
await page.waitForTimeout(1400);
await page.screenshot({ path: `${OUT}/23e-hellfort.png` });

// 回到出生点
await page.evaluate(() => {
  const g = window.__game;
  g.world.warmup(Math.floor(g.spawn.x / 16), Math.floor(g.spawn.z / 16));
  g.player.pos.set(g.spawn.x, g.spawn.y + 1, g.spawn.z);
  g.player.vel.set(0, 0, 0);
});
await page.waitForTimeout(800);

// --- Terraria 3D · Phase 2:垂直分层/洞穴/地狱/岩浆/深度计 ---
// 洞穴层:找一个洞传送进去,应漆黑(雾深),放火把照亮
const caveSpot = await page.evaluate(() => {
  const g = window.__game;
  for (let dx = 0; dx < 40; dx++) {
    for (let y = 40; y < 96; y++) {
      const x = Math.floor(g.spawn.x) + dx;
      const z = Math.floor(g.spawn.z);
      if (
        g.world.getBlock(x, y, z) === 0 &&
        g.world.getBlock(x, y + 1, z) === 0 &&
        g.world.isSolid(x, y - 1, z)
      ) {
        g.player.pos.set(x + 0.5, y + 0.01, z + 0.5);
        g.player.vel.set(0, 0, 0);
        g.player.yaw = 0;
        g.player.pitch = -0.1;
        return { x, y, z };
      }
    }
  }
  return null;
});
await page.waitForTimeout(600);
if (caveSpot) {
  const caveEnv = await page.evaluate(() => {
    const g = window.__game;
    const meter = document.getElementById('depth-meter').textContent;
    return { layer: g.layer().name, fog: g.env().fog, meter };
  });
  // 放火把照亮洞穴
  await page.keyboard.press('Digit5');
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(250);
  await page.click('#inv-grid .inv-slot[title="火把"]');
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    const g = window.__game;
    g.player.yaw = 0;
    g.player.pitch = -0.9;
  });
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/21-cavern-torch.png` });
  const fogLum2 = caveEnv.fog[0] + caveEnv.fog[1] + caveEnv.fog[2];
  check(
    '洞穴层:漆黑氛围与深度计',
    caveEnv.layer === '洞穴层' && fogLum2 < 0.15 && caveEnv.meter.includes('洞穴'),
    `层 ${caveEnv.layer},雾亮度 ${fogLum2.toFixed(3)},深度计 "${caveEnv.meter}"`,
  );
} else {
  check('洞穴层:漆黑氛围与深度计', false, '未找到洞穴');
}
await page.keyboard.press('Digit1');

// 地狱:传送到熔洞,断言层/雾/岩浆存在,截图
const hellInfo = await page.evaluate(() => {
  const g = window.__game;
  const sx = Math.floor(g.spawn.x);
  const sz = Math.floor(g.spawn.z);
  // 区域搜索:找灰烬岸(高出岩浆海的地面)落脚
  for (let dx = -38; dx <= 38; dx += 2) {
    for (let dz = -38; dz <= 38; dz += 2) {
      const x = sx + dx;
      const z = sz + dz;
      for (let y = 10; y < 19; y++) {
        if (
          g.world.getBlock(x, y, z) === 0 &&
          g.world.getBlock(x, y + 1, z) === 0 &&
          g.world.isSolid(x, y - 1, z)
        ) {
          g.player.pos.set(x + 0.5, y + 0.01, z + 0.5);
          g.player.vel.set(0, 0, 0);
          g.player.yaw = Math.PI / 2;
          g.player.pitch = -0.1;
          let lava = 0;
          for (let ax = -20; ax <= 20; ax++) {
            for (let az = -20; az <= 20; az++) {
              for (let ay = 2; ay <= 9; ay++) {
                if (g.world.getBlock(x + ax, ay, z + az) === 35) lava++;
              }
            }
          }
          return { y, lava };
        }
      }
    }
  }
  return null;
});
await page.waitForTimeout(600);
if (hellInfo) {
  const hellEnv = await page.evaluate(() => ({
    layer: window.__game.layer().name,
    fog: window.__game.env().fog,
    meter: document.getElementById('depth-meter').textContent,
  }));
  await page.screenshot({ path: `${OUT}/21b-hell.png` });
  check(
    '地狱:岩浆海与暗红氛围',
    hellEnv.layer === '地狱' && hellInfo.lava > 50 && hellEnv.fog[0] > hellEnv.fog[2],
    `层 ${hellEnv.layer},附近岩浆 ${hellInfo.lava} 格,雾偏红 ${hellEnv.fog[0] > hellEnv.fog[2]},深度计 "${hellEnv.meter}"`,
  );
  // 岩浆伤害:跳进岩浆 1.3s
  const hpBefore = await page.evaluate(() => {
    const g = window.__game;
    g.setHp(10);
    const x = Math.floor(g.player.pos.x);
    const z = Math.floor(g.player.pos.z);
    for (let r = 1; r < 30; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (g.world.getBlock(x + dx, 8, z + dz) === 35) {
            g.player.pos.set(x + dx + 0.5, 8.2, z + dz + 0.5);
            g.player.vel.set(0, 0, 0);
            return g.hp();
          }
        }
      }
    }
    return -1;
  });
  await page.waitForTimeout(1300);
  const hpAfter = await page.evaluate(() => {
    const g = window.__game;
    const hp = g.hp();
    g.player.pos.set(g.spawn.x, g.spawn.y + 1, g.spawn.z);
    g.player.vel.set(0, 0, 0);
    g.setHp(10);
    return hp;
  });
  check(
    '岩浆:接触伤害',
    hpBefore === 10 && hpAfter < 10,
    `入岩浆前 HP=${hpBefore},1.3s 后 HP=${hpAfter}`,
  );
} else {
  check('地狱:岩浆海与暗红氛围', false, '未找到地狱落脚点');
  check('岩浆:接触伤害', false, '未找到地狱落脚点');
}
await page.waitForTimeout(600);

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
const touchLayoutAt = async (width) => {
  await mob.setViewportSize({ width, height: 375 });
  await mob.waitForTimeout(120);
  const r = await mob.evaluate(() => {
    const pick = (id) => {
      const b = document.getElementById(id).getBoundingClientRect();
      return { x: b.x, y: b.y, right: b.right, bottom: b.bottom, width: b.width, height: b.height };
    };
    const hotbar = document.getElementById('hotbar').getBoundingClientRect();
    return {
      viewport: { w: innerWidth, h: innerHeight },
      boxes: {
        joy: pick('joy-base'),
        jump: pick('btn-jump'),
        sprint: pick('btn-sprint'),
        pause: pick('btn-pause'),
        inv: pick('btn-inv'),
        time: pick('btn-time'),
        hotbar: {
          x: hotbar.x,
          y: hotbar.y,
          right: hotbar.right,
          bottom: hotbar.bottom,
          width: hotbar.width,
          height: hotbar.height,
        },
      },
    };
  });
  const inside = (b) => b.x >= 0 && b.y >= 0 && b.right <= r.viewport.w && b.bottom <= r.viewport.h;
  const overlap = (a, b, gap = 4) =>
    !(a.right + gap <= b.x || b.right + gap <= a.x || a.bottom + gap <= b.y || b.bottom + gap <= a.y);
  const pairs = [
    ['joy', 'hotbar'],
    ['jump', 'sprint'],
    ['jump', 'hotbar'],
    ['sprint', 'hotbar'],
    ['pause', 'jump'],
    ['inv', 'jump'],
    ['time', 'jump'],
  ];
  const badPair = pairs.find(([a, b]) => overlap(r.boxes[a], r.boxes[b]));
  const allInside = Object.values(r.boxes).every(inside);
  const sameActionSize =
    Math.abs(r.boxes.jump.width - r.boxes.sprint.width) < 1 &&
    Math.abs(r.boxes.jump.height - r.boxes.sprint.height) < 1;
  const lowered = r.boxes.joy.y > 160 && r.boxes.jump.y > 160 && r.boxes.sprint.y > 225;
  return {
    ok: allInside && sameActionSize && lowered && !badPair,
    detail: `${width}px:摇杆y=${r.boxes.joy.y.toFixed(0)},跳y=${r.boxes.jump.y.toFixed(0)},冲刺y=${r.boxes.sprint.y.toFixed(0)},${badPair ? `重叠 ${badPair.join('/')}` : '无重叠'}`,
  };
};
const layout812 = await touchLayoutAt(812);
const layout667 = await touchLayoutAt(667);
await mob.setViewportSize({ width: 812, height: 375 });
await mob.waitForTimeout(120);
check(
  '触屏按钮布局',
  layout812.ok && layout667.ok,
  `${layout812.detail}; ${layout667.detail}`,
);
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
// 冲刺按钮:按住时最大水平速度应显著高于步行(速度采样,不受地形阻挡影响)
const runTrial = async (sprint) => {
  // 先移动鼠标/按住按钮(mouse.move 的 movementX 会转动视角),再复位朝向
  if (sprint) {
    const sb = await (await mob.$('#btn-sprint')).boundingBox();
    await mob.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
    await mob.mouse.down();
  }
  await mob.evaluate(() => {
    const g = window.__game;
    const s = g.spawn;
    g.player.pos.set(s.x, s.y + 0.01, s.z);
    g.player.vel.set(0, 0, 0);
    g.player.yaw = 0;
    g.player.pitch = 0;
  });
  await mob.waitForTimeout(150);
  await mob.keyboard.down('KeyW');
  let vmax = 0;
  for (let i = 0; i < 7; i++) {
    await mob.waitForTimeout(120);
    const v = await mob.evaluate(() => {
      const p = window.__game.player;
      return Math.hypot(p.vel.x, p.vel.z);
    });
    vmax = Math.max(vmax, v);
  }
  await mob.keyboard.up('KeyW');
  if (sprint) await mob.mouse.up();
  return vmax;
};
const walkV = await runTrial(false);
const sprintV = await runTrial(true);
check(
  '触屏冲刺按钮',
  sprintV > walkV + 1.5 && sprintV > 5.5,
  `步行峰值 ${walkV.toFixed(1)} m/s → 冲刺峰值 ${sprintV.toFixed(1)} m/s`,
);

// 背包按钮开合(修复:此前背包打开后盖住按钮无法退出)+ 时钟按钮加速时间
await mob.click('#btn-inv');
await mob.waitForTimeout(250);
const mInvOpen = await mob.evaluate(() =>
  document.getElementById('inventory').classList.contains('open'),
);
await mob.mouse.click(30, 200); // 点背包空白背景处关闭
await mob.waitForTimeout(250);
const mInvClosed = await mob.evaluate(
  () => !document.getElementById('inventory').classList.contains('open'),
);
const tc0 = await mob.evaluate(() => window.__game.env().time);
const tb = await (await mob.$('#btn-time')).boundingBox();
await mob.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
await mob.mouse.down();
await mob.waitForTimeout(500);
await mob.mouse.up();
const tc1 = await mob.evaluate(() => window.__game.env().time);
const tcDelta = (((tc1 - tc0) % 1) + 1) % 1;
// 视角按钮:切到第三人称再切回
await mob.click('#btn-view');
await mob.waitForTimeout(200);
const mView1 = await mob.evaluate(() => window.__game.view());
await mob.click('#btn-view');
await mob.waitForTimeout(200);
const mView2 = await mob.evaluate(() => window.__game.view());
check(
  '触屏背包/时钟/视角按钮',
  mInvOpen && mInvClosed && tcDelta > 0.03 && mView1 === 1 && mView2 === 0,
  `背包 开 ${mInvOpen} → 点空白关 ${mInvClosed},时钟 0.5s 推进 ${tcDelta.toFixed(3)} 天,视角 ${mView1}→${mView2}`,
);
// 手势:屏幕中心点按放置玻璃,再原地长按挖掉(基岩版交互)
await mob.mouse.move(406, 187); // 先归位鼠标,避免后续 move 的视角增量
await mob.evaluate(() => {
  const g = window.__game;
  g.mobs.setAutoSpawn(false);
  g.mobs.clear();
  const s = g.spawn;
  const x = Math.floor(s.x) + 4;
  const z = Math.floor(s.z) - 3;
  const h = g.world.gen.heightAt(x, z);
  g.player.pos.set(x + 0.5, h + 1.01, z + 0.5);
  g.player.vel.set(0, 0, 0);
  g.player.yaw = 0;
  g.player.pitch = -0.6;
});
await mob.click('#hotbar .slot:nth-child(9)'); // 点物品栏选玻璃
await mob.waitForTimeout(250);
const slotGlass = await mob.evaluate(
  () => window.__game.ui.hotbar()[window.__game.ui.selected()] === 12,
);
const countGlass = () =>
  mob.evaluate(() => {
    const g = window.__game;
    const p = g.player.pos;
    let n = 0;
    for (let dy = 1; dy >= -1; dy--) {
      for (let dx = -4; dx <= 4; dx++) {
        for (let dz = -4; dz <= 4; dz++) {
          if (
            g.world.getBlock(Math.floor(p.x) + dx, Math.floor(p.y) + dy, Math.floor(p.z) + dz) ===
            12
          ) {
            n++;
          }
        }
      }
    }
    return n;
  });
await mob.mouse.click(406, 187, { delay: 40 }); // 中心点按 → 放置
await mob.waitForTimeout(300);
const gTap = (await countGlass()) > 0;
await mob.mouse.move(406, 187); // 原地长按 → 挖掉刚放的玻璃(0.25s)
await mob.mouse.down();
await mob.waitForTimeout(800);
await mob.mouse.up();
await mob.waitForTimeout(200);
const gMined = (await countGlass()) === 0;
check(
  '触屏手势(点按放置/长按挖掘)',
  slotGlass && gTap && gMined,
  `点物品栏选玻璃 ${slotGlass},点按放置 ${gTap},长按挖掉 ${gMined}`,
);
await mob.close();
check(
  '触屏操控',
  touchUI && tMoved > 2 && Math.abs(yaw1 - yaw0) > 0.15 && ty1 > ty0 + 0.3,
  `UI ${touchUI},摇杆移动 ${tMoved.toFixed(1)} 格,视角 Δ${Math.abs(yaw1 - yaw0).toFixed(2)},跳起 +${(ty1 - ty0).toFixed(2)} 格`,
);

check('无控制台错误', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ✗`);
process.exit(failed === 0 ? 0 : 1);
