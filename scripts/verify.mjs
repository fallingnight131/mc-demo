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
for (let i = 0; i < 3; i++) {
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(350); // 等下落
}
const pAfterDig = await pos();
const dug =
  (await blockAt(bx, startY, bz)) === 0 &&
  (await blockAt(bx, startY - 1, bz)) === 0 &&
  (await blockAt(bx, startY - 2, bz)) === 0;
check('挖掘三格', dug && pAfterDig[1] < pd[1] - 2.5, `下沉 ${(pd[1] - pAfterDig[1]).toFixed(2)} 格`);
await page.screenshot({ path: `${OUT}/4-after-dig.png` });

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
  () => [...document.querySelectorAll('.slot')].findIndex((el) => el.classList.contains('selected')),
);
check('中键选取', slotSel === 3, `选中槽位 ${slotSel + 1}(圆石应为 4)`);

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

// --- 环顾远景 ---
await look(0, -45, 30);
await look(10, 0, 22);
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/7-vista.png` });

check('无控制台错误', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项失败 ✗`);
process.exit(failed === 0 ? 0 : 1);
