// 入口 · 组装根:构造渲染器/世界/各系统,接线事件与输入,驱动主循环。
// 游戏规则不写在这里 —— 按 ARCHITECTURE.md 分层放进 src/game/* 与 src/ui/*:
// 战斗 combat / 库存 inventory / 交互 interact / 氛围 ambience / 实体 entities+tnt+projectiles /
// 视角 view / 面板 ui/panels / 物品注册表 content/items / 存档分节 core/save / 事件 core/events。
import * as THREE from 'three';
import { Block } from './blocks';
import { CHUNK_SIZE, REACH, RENDER_DISTANCE, SEA_LEVEL } from './config';
import { itemName } from './content/items';
import { Input } from './controls';
import { EventBus } from './core/events';
import { SaveManager } from './core/save';
import { clockText, computeDayNight } from './daynight';
import { FallingBlocks } from './falling';
import { getAccount } from './game/account';
import { Ambience, layerNameOf } from './game/ambience';
import { buildCodexCategories } from './game/codex';
import { Combat } from './game/combat';
import { EntityManager } from './game/entities';
import { Flags } from './game/flags';
import { Interact } from './game/interact';
import { Inventory, HOTBAR_SIZE } from './game/inventory';
import { Projectiles } from './game/projectiles';
import { TntSystem } from './game/tnt';
import { View } from './game/view';
import { HUD } from './hud';
import { ItemDrops } from './items';
import { Mobs, type MobKind } from './mobs';
import { Particles } from './particles';
import { Player } from './player';
import { createWorldMaterials } from './render/materials';
import { Sky, SKY_HORIZON } from './sky';
import { Sound } from './sound';
import { PLACEABLE } from './blocks';
import { Tool } from './tools';
import { isTouchDevice, TouchControls } from './touch';
import { initAccountPane } from './ui/account';
import { Panels } from './ui/panels';
import { initSettings, loadSensitivity } from './ui/settings';
import { World, type EditData } from './world';

// --- 渲染器与场景 ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.domElement.classList.add('game');
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY_HORIZON);
const fogFar = RENDER_DISTANCE * CHUNK_SIZE * 0.92;
scene.fog = new THREE.Fog(SKY_HORIZON, fogFar * 0.55, fogFar);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 800);
camera.rotation.order = 'YXZ';

// --- 材质与世界 ---
const mats = createWorldMaterials();
const world = new World(mats.solidMat, mats.waterMat);
scene.add(world.group);

// --- 存档(分节注册,字段与历史存档 mc-demo-save-v1 一致) ---
// 存储键按身份隔离:游客 = 历史键,账号 = 按用户后缀;登录态的云对账
// 已在 boot.ts 完成(胜者写入本地缓冲),这里照常同步读档(BACKEND.md §6)。
const account = getAccount();
const save = new SaveManager(account.storageKey);
save.onSaved = (json) => account.onLocalSaved(json); // 登录态防抖推送云端
save.read();
save.register('edits', {
  save: () => world.serializeEdits(),
  load: (d) => {
    if (d && typeof d === 'object') world.loadEdits(d as EditData);
  },
});

// 玩家开机位置:窥视存档一次性消费(必须在 warmup 之后、经嵌墙自救校验后应用,
// 所以不走注册即加载;'player' 分节在下方只注册 save 方向)
interface SavedPlayer {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  slot: number;
}
const savedPlayer = (save.peek('player') as SavedPlayer | undefined) ?? null;
const spawn = world.gen.findSpawn();
const start = savedPlayer ?? { x: spawn.x, y: spawn.y, z: spawn.z, yaw: 0, pitch: 0, slot: 0 };
world.warmup(Math.floor(start.x / CHUNK_SIZE), Math.floor(start.z / CHUNK_SIZE));

// 存档位置嵌在实体方块里(如曾卡进地底)则放弃它,回到出生点
if (
  world.isSolid(Math.floor(start.x), Math.floor(start.y + 0.1), Math.floor(start.z)) &&
  world.isSolid(Math.floor(start.x), Math.floor(start.y + 1.6), Math.floor(start.z))
) {
  start.x = spawn.x;
  start.y = spawn.y;
  start.z = spawn.z;
  start.yaw = 0;
  start.pitch = 0;
}

const player = new Player(world);
player.pos.set(start.x, start.y, start.z);
player.yaw = start.yaw;
player.pitch = start.pitch;
save.register('creative', {
  save: () => player.creative,
  load: (d) => {
    player.creative = d === true;
  },
});

// --- 核心服务 ---
const events = new EventBus();
const flags = new Flags(events);
flags.onDirty = () => save.markDirty();
save.register('flags', flags);

const hud = new HUD();
const sound = new Sound();
const sky = new Sky();
scene.add(sky.group);
const particles = new Particles(mats.textures.atlas, world);
scene.add(particles.points);
const drops = new ItemDrops(mats.textures.atlas, world);
scene.add(drops.group);
const falling = new FallingBlocks(mats.textures.atlas, world);
scene.add(falling.group);
const mobs = new Mobs(
  world,
  (x, z) => world.gen.heightAt(x, z),
  (x, y, z) => world.lights.lightAt(x, y, z),
);
scene.add(mobs.group);

// 世界 ↔ 实体的既有直连回调(紧耦合的一对一通知,见 ARCHITECTURE.md §3.1)
world.water.onLanding = (cells) => {
  for (const [x, y, z] of cells) {
    if (Math.hypot(x - player.pos.x, z - player.pos.z) > 48) continue;
    particles.burst(x, y, z, Block.Water, 4);
  }
};
world.onBlockChanged = (x, y, z) => {
  falling.wake(x, y + 1, z); // 上方失去支撑
  falling.wake(x, y, z); // 悬空放置的重力方块
};
world.water.onWashed = (x, y, z, id) => {
  drops.spawn(x, y, z, id); // 火把被水冲走,掉出可拾取物
  sound.splash();
};
falling.onLand = (x, y, z, id) => sound.place(id);

// --- 游戏系统 ---
const inventory = new Inventory(hud, mats.textures, world, save, events);
inventory.isCreative = () => player.creative;
inventory.selectedSlot = Math.min(Math.max(start.slot, 0), HOTBAR_SIZE - 1);
inventory.registerSave();
save.register('player', {
  save: () => ({
    x: player.pos.x,
    y: player.pos.y,
    z: player.pos.z,
    yaw: player.yaw,
    pitch: player.pitch,
    slot: inventory.selectedSlot,
  }),
  load: () => {}, // 开机时已消费(见上)
});
inventory.refreshHotbar();
inventory.refreshInventory();

const combat = new Combat({
  player,
  world,
  mobs,
  inventory,
  hud,
  sound,
  events,
  spawn,
  isCreative: () => player.creative,
});
save.register('hp', {
  save: () => combat.hp,
  load: (d) => {
    if (typeof d === 'number') combat.hp = Math.max(1, Math.min(10, d));
  },
});
hud.setHearts(combat.hp);

const view = new View(camera, player, world, hud, mats.textures, inventory, particles);
scene.add(view.model.group);

const entities = new EntityManager();
const tnt = new TntSystem(
  {
    scene,
    world,
    mobs,
    player,
    sound,
    particles,
    events,
    entities,
    onShake: (s) => {
      view.shake = Math.max(view.shake, s);
    },
    // 宝箱被炸毁:内容物溢出成掉落物(上限护帧),开着的双栏立即关闭
    onChestDestroyed: (x, y, z) => {
      const { slots, wasOpen } = inventory.spillChest(x, y, z);
      let spawned = 0;
      for (const s of slots) {
        if (!s) continue;
        for (let i = 0; i < s.count && spawned < 32; i++, spawned++) {
          drops.spawn(x, y, z, s.id);
        }
      }
      if (wasOpen) {
        panels.close('chest', true);
        hud.toast('宝箱被炸毁了!');
      }
    },
  },
  mats.textures.atlas,
);
const projectiles = new Projectiles(world, mobs, entities);
scene.add(projectiles.group);

const ambience = new Ambience(scene, camera, sky, world, player, sound, particles, mats);
save.register('time', ambience);

const interact = new Interact({
  scene,
  world,
  player,
  inventory,
  combat,
  sound,
  particles,
  drops,
  events,
  onSwing: () => view.swingArm(),
  lookDir: (out) => view.lookDir(out),
  isCreative: () => player.creative,
  onDenied: (name) => hud.toast(`背包里没有「${name}」,先去采集`),
});
// 方块点按注册表:宝箱开箱;手持打火石点燃 TNT(因此 TNT 可互相堆叠)
interact.registerBlockUse(Block.Chest, (hit) => {
  sound.chest();
  inventory.openChest(hit.x, hit.y, hit.z);
  panels.open('chest');
  return true;
});
interact.registerBlockUse(Block.TNT, (hit) => {
  if (inventory.heldId() !== Tool.FlintSteel) return false; // 落回放置(堆 TNT)
  sound.spark();
  tnt.ignite(hit.x, hit.y, hit.z);
  return true;
});

// --- 生物事件接线 ---
mobs.onDeath = (kind, x, y, z) => {
  // 白烟消失(借雪的白色纹理当烟雾)
  particles.burst(Math.floor(x), Math.floor(y), Math.floor(z), Block.Snow, 14);
  sound.mobVoice(kind, 0.9, true);
  events.emit('mobKilled', { kind, x, y, z });
};
mobs.onVoice = (kind, dist) => sound.mobVoice(kind, Math.max(0.12, 1 - dist / 28));
mobs.onAttack = (dmg, dirX, dirZ) => combat.hurtPlayer(dmg, 'mob', dirX, dirZ);
mobs.onBurning = (x, y, z) => {
  particles.burst(Math.floor(x), Math.floor(y), Math.floor(z), Block.Snow, 5);
};

// 掉落物拾取:入包 + 计数 + 反馈;背包收纳不下时守卫拦截,物品留在地上
drops.canPickup = (id) => inventory.canFit(id);
drops.onPickup = (id) => {
  if (!inventory.pickup(id)) return; // 兜底(守卫已拦,正常不走到)
  sound.pop();
  hud.toast(`+1 ${itemName(id)}`);
};

// --- 输入与面板 ---
const input = new Input(renderer.domElement);
const touch =
  isTouchDevice() || new URLSearchParams(location.search).has('touch')
    ? new TouchControls()
    : null;
if (touch) {
  document.body.appendChild(touch.root);
  document.body.classList.add('touch'); // 竖屏提示等 CSS 钩子
}

let started = false;
let sensScale = loadSensitivity();

/** 进入游戏:触屏没有指针锁定,直接软锁 */
function engage(): void {
  if (touch) input.forceLock();
  else input.requestLock(() => hud.setOverlayHint('指针锁定被浏览器拒绝,请稍候约 1 秒再点击'));
}

const panels = new Panels(
  engage,
  () => input.locked,
  () => hud.setOverlayVisible(!input.locked, started),
  () => interact.cancel(),
);
panels.register('inventory', {
  el: document.getElementById('inventory')!,
  onOpen: () => inventory.refreshInventory(), // 反映当前背包(收集到的物品)
});
panels.register('chest', {
  el: document.getElementById('chest')!,
  onClose: () => inventory.closeChest(),
});
panels.register('codex', { el: document.getElementById('codex')!, modal: false });
inventory.onInventoryPick = () => panels.close('inventory', true);

document.getElementById('inv-close')!.addEventListener('click', () => panels.close('inventory', true));
document.getElementById('chest-close')!.addEventListener('click', () => panels.close('chest', true));
hud.buildCodex(buildCodexCategories(mats.textures));
document.getElementById('open-codex')!.addEventListener('click', (e) => {
  e.stopPropagation();
  panels.open('codex');
});
document.getElementById('codex-close')!.addEventListener('click', (e) => {
  e.stopPropagation();
  panels.close('codex', true);
});

function saveGame(): void {
  save.saveNow();
  world.editsDirty = false;
}
const onUnload = () => {
  saveGame();
  void account.flushNow(true); // keepalive:卸载后请求仍会完成
};
window.addEventListener('beforeunload', onUnload);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) onUnload();
});
account.onConflict = () =>
  hud.toast('云端存档有更新(另一设备?),本机改动将在下次启动时对账');
if (account.conflictNotice) {
  hud.toast('云存档冲突:已采用云端版本,本机旧改动已备份');
}

// 清档重开:reset() 删档并阻断一切自动存档写回(防 reload 前的
// visibilitychange 把旧状态原样写回,存档删了就是删了);登录态连云档一起清
document.getElementById('reset-save')!.addEventListener('click', (e) => {
  e.stopPropagation();
  save.reset();
  window.removeEventListener('beforeunload', onUnload);
  void account.clearSave().finally(() => location.reload());
});

function setCreative(v: boolean): void {
  player.creative = v;
  (document.getElementById('opt-creative') as HTMLInputElement).checked = v;
  if (v) hud.toast('创造模式:飞行观察(空格升 / Shift 降)');
  else hud.toast('生存模式');
  saveGame();
}

// 静音开关(M),跨会话记忆;设置面板与之双向同步
try {
  sound.setMuted(localStorage.getItem('mc-demo-muted') === '1');
} catch {
  // 忽略
}
initSettings({
  sound,
  getCreative: () => player.creative,
  setCreative,
  getSens: () => sensScale,
  setSens: (v) => {
    sensScale = v;
  },
});
initAccountPane(account, saveGame);

const overlayEl = document.getElementById('overlay')!;
overlayEl.addEventListener('click', () => engage());
// 兜底:游戏中途失锁且无面板时,点画布重新锁定
renderer.domElement.addEventListener('click', () => {
  if (!input.locked && !panels.modalOpen && started) engage();
});

input.onLockChange = (locked) => {
  if (locked) {
    started = true;
    sound.unlock();
    hud.setOverlayHint('');
    panels.forceCloseModals(); // 重新锁定时背包/宝箱必然是关闭状态
  }
  hud.setOverlayVisible(!locked && !panels.modalOpen, started);
  if (!locked) {
    sound.setAmbience(0, 0); // 暂停时环境声淡出
    sound.setScape(0, 0);
  }
  interact.cancel();
};

input.onSelectSlot = (i) => inventory.select(i);
input.onWheel = (dir) => inventory.wheel(dir);
hud.onSlotTap = (i) => inventory.select(i);

input.onKey = (code) => {
  if (code === 'KeyM') {
    const m = !sound.muted;
    sound.setMuted(m);
    (document.getElementById('opt-sound') as HTMLInputElement).checked = !m;
    try {
      localStorage.setItem('mc-demo-muted', m ? '1' : '0');
    } catch {
      // 忽略
    }
    hud.toast(m ? '音效:关' : '音效:开');
  } else if (code === 'F5') {
    if (input.locked) view.toggleView();
  } else if (code === 'Minus' || code === 'Equal') {
    if (input.locked) view.zoom(code === 'Minus' ? 0.5 : -0.5);
  } else if (code === 'KeyE') {
    if (panels.isOpen('chest')) panels.close('chest', true);
    else if (panels.isOpen('inventory')) panels.close('inventory', true);
    else if (input.locked) panels.open('inventory');
  } else if (code === 'Escape' && panels.isOpen('chest')) {
    panels.close('chest', false); // 关宝箱,回到暂停界面
  } else if (code === 'Escape' && panels.isOpen('inventory')) {
    panels.close('inventory', false); // 关背包,回到暂停界面
  }
};

interact.bindInput(input, touch, () => panels.modalOpen !== null);
if (touch) {
  touch.onPause = () => input.forceUnlock();
  touch.onInventory = () => {
    if (panels.isOpen('inventory')) panels.close('inventory', true);
    else if (input.locked) panels.open('inventory');
  };
  touch.onView = () => {
    if (input.locked) view.toggleView();
  };
}

// --- 主循环 ---
const MOUSE_SENS = 0.0022;
let lastTime = performance.now();
let fpsFrames = 0;
let fpsTime = 0;
let fpsValue = 0;
let saveTimer = 0;
const playerCenterVec = new THREE.Vector3();

function frame(now: number): void {
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  if (input.locked) {
    const look = input.consumeLook();
    let lookDx = look.dx;
    let lookDy = look.dy;
    if (touch) {
      const tl = touch.consumeLook();
      lookDx += tl.dx;
      lookDy += tl.dy;
    }
    player.yaw -= lookDx * MOUSE_SENS * sensScale;
    player.pitch -= lookDy * MOUSE_SENS * sensScale;
    const maxPitch = Math.PI / 2 - 0.001;
    player.pitch = Math.max(-maxPitch, Math.min(maxPitch, player.pitch));

    player.update(dt, {
      forward:
        (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0) + (touch?.moveVec.y ?? 0),
      strafe:
        (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0) + (touch?.moveVec.x ?? 0),
      jump: input.isDown('Space') || (touch?.jumpHeld ?? false),
      sprint:
        input.isDown('ShiftLeft') || input.isDown('ShiftRight') || (touch?.sprintHeld ?? false),
    });

    // 兜底:跌出世界则传回出生点(清零落速记录,免得救援落地被记摔伤)
    if (player.pos.y < -20) {
      player.pos.set(spawn.x, spawn.y + 2, spawn.z);
      player.vel.set(0, 0, 0);
      combat.clearFallTracking();
    }
  } else {
    input.consumeLook();
    touch?.consumeLook();
  }

  // 世界推进(暂停时冻结水流)
  world.update(player.pos.x, player.pos.z, input.locked ? dt : 0);

  // 昼夜与深度亮度;按住 T 或触屏时钟按钮时间快流
  const timeFast = input.isDown('KeyT') || (touch?.timeHeld ?? false);
  const bright = ambience.updateTime(dt, input.locked, timeFast);
  drops.setBrightness(bright);
  particles.setBrightness(bright);
  mobs.setBrightness(bright);
  falling.setBrightness(bright);
  entities.setBrightness(bright);
  view.setBrightness(bright);
  mobs.nightFactor = ambience.dn.starAlpha;
  mobs.daylight = ambience.dn.brightness > 0.55;

  // 回血 + 岩浆接触伤害
  combat.updateVitals(dt, input.locked);

  // 周期性存档(有改动才写)
  saveTimer += dt;
  if (saveTimer >= 5) {
    saveTimer = 0;
    if (world.editsDirty || save.dirty) saveGame();
  }

  // 相机跟随(含震屏与第三人称)→ 雾/水下/天空氛围
  view.updateCamera(dt);
  ambience.applyAtmosphere(dt, now);

  // 准星高亮 + 长按挖掘 + 裂纹
  interact.update(dt, input.locked);

  if (input.locked) {
    entities.update(dt); // 点燃的 TNT / 弹幕
    drops.update(dt, playerCenterVec.set(player.pos.x, player.pos.y + 0.9, player.pos.z));
    mobs.update(dt, playerCenterVec);
    falling.update(dt);
    ambience.updateSounds(dt, now);
    combat.updateBody(dt); // 脚步/落地/摔落伤害/入水
  }

  particles.update(dt);

  // 疾跑视野拉伸 + 玩家模型姿态 + 手持物同步
  view.updateModel(
    dt,
    input.isDown('ShiftLeft') || input.isDown('ShiftRight') || (touch?.sprintHeld ?? false),
  );

  // FPS / 深度计 / 调试信息
  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    fpsValue = Math.round(fpsFrames / fpsTime);
    fpsFrames = 0;
    fpsTime = 0;
  }
  const layerName = layerNameOf(player.pos.y);
  const depth = Math.round(SEA_LEVEL + 6 - player.pos.y);
  const biomeLabel =
    layerName === '地表'
      ? { forest: '森林', jungle: '丛林', corruption: '腐化之地', crimson: '血腥之地' }[
          world.gen.biomeAt(player.pos.x, player.pos.z)
        ]
      : layerName;
  hud.setDebug(
    `FPS ${fpsValue}\n` +
      `XYZ ${player.pos.x.toFixed(1)} / ${player.pos.y.toFixed(1)} / ${player.pos.z.toFixed(1)}\n` +
      `时间 ${clockText(ambience.timeOfDay)}${touch ? '' : '(按住 T 加速)'}\n` +
      `${layerName} · 深度 ${depth > 0 ? depth : depth}`,
  );
  hud.setLayer(biomeLabel, depth);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  particles.setViewport(window.innerHeight, camera.projectionMatrix.elements[5]);
});
particles.setViewport(window.innerHeight, camera.projectionMatrix.elements[5]);

hud.setOverlayVisible(true, false);

// 自动化测试模式:跳过指针锁定(无头浏览器不支持),并暴露内部状态供断言。
// ⚠ 该接口是 e2e 的契约(ARCHITECTURE.md §6.3):字段只增不改。
if (new URLSearchParams(location.search).has('test')) {
  input.forceLock();
  (window as unknown as Record<string, unknown>).__game = {
    world,
    player,
    spawn,
    drops,
    stats: inventory.stats,
    sound,
    events,
    flags,
    projectiles,
    save: saveGame,
    account: {
      user: () => account.user,
      storageKey: () => account.storageKey,
      flush: () => account.flushNow(),
    },
    setTime: (v: number) => ambience.setTime(v),
    ui: {
      hotbar: () => [...inventory.hotbar],
      selected: () => inventory.selectedSlot,
      // 调试:装配任意快捷栏布局 / 取经典方块布局(供 e2e 在清档 reload 后沿用)
      setHotbar: (ids: number[]) => inventory.setHotbar(ids),
      blockHotbar: () => PLACEABLE.slice(0, HOTBAR_SIZE),
      // 调试:把全部物品塞进背包(供 e2e 从背包取任意方块)
      giveAll: () => inventory.giveAll(),
      // 现有数(所有权;徽章与放置消耗断言用)
      owned: (id: number) => inventory.ownedCount(id),
    },
    chest: {
      open: (x: number, y: number, z: number) => inventory.openChest(x, y, z),
      stored: (x: number, y: number, z: number) => {
        const slots = inventory.chestStore.get(`${x},${y},${z}`);
        return slots ? slots.filter((s) => s !== null).length : -1;
      },
    },
    tnt: { ignite: (x: number, y: number, z: number, fuse?: number) => tnt.ignite(x, y, z, fuse) },
    view: () => view.viewMode,
    toggleView: () => view.toggleView(),
    modelVisible: () => view.model.group.visible,
    heldId: () => view.heldId,
    hp: () => combat.hp,
    layer: () => ({ name: layerNameOf(player.pos.y), y: player.pos.y }),
    biome: () => world.gen.biomeAt(player.pos.x, player.pos.z),
    deaths: () => combat.deaths,
    creative: () => player.creative,
    setCreative: (v: boolean) => setCreative(v),
    structures: () => ({
      tree: world.gen.structures.tree,
      islands: world.gen.structures.islands,
      dungeon: world.gen.structures.dungeon,
      hellForts: world.gen.structures.hellForts,
    }),
    setHp: (v: number) => combat.setHp(v),
    mobs: {
      count: () => mobs.count,
      list: () => mobs.debugList(),
      spawnAt: (x: number, y: number, z: number, kind?: MobKind) => mobs.spawnAt(x, y, z, kind),
      clear: () => mobs.clear(),
      setAutoSpawn: (v: boolean) => {
        mobs.autoSpawn = v;
      },
    },
    env: () => {
      const s = computeDayNight(ambience.timeOfDay);
      const fog = scene.fog as THREE.Fog;
      return {
        time: ambience.timeOfDay,
        brightness: s.brightness,
        starAlpha: s.starAlpha,
        fog: [fog.color.r, fog.color.g, fog.color.b],
      };
    },
  };
}

requestAnimationFrame(frame);
