// 入口:渲染器、场景、游戏循环与交互逻辑的组装
import * as THREE from 'three';
import { buildBlockGeometry } from './blockmesh';
import { baseBlock, Block, BLOCK_DEFS, isWater, PLACEABLE, pumpkinVariant } from './blocks';
import {
  CHUNK_SIZE,
  EYE_HEIGHT,
  LAVA_LEVEL,
  LAYER_CAVERN_TOP,
  LAYER_HELL_TOP,
  LAYER_SKY_BOTTOM,
  LAYER_UNDERGROUND_TOP,
  REACH,
  RENDER_DISTANCE,
  SEA_LEVEL,
  WORLD_WALL_RADIUS,
} from './config';
import { Input } from './controls';
import { clockText, computeDayNight, DAY_LENGTH } from './daynight';
import { FallingBlocks } from './falling';
import { HUD } from './hud';
import { ItemDrops } from './items';
import { Mobs, type MobKind } from './mobs';
import { Particles } from './particles';
import { Player } from './player';
import { PlayerModel, thirdPersonDist } from './playermodel';
import { Sky, SKY_HORIZON } from './sky';
import { materialOf, Sound } from './sound';
import { CHEST_LOOT } from './structures';
import { isTool, Tool, TOOL_DEFS, TOOL_IDS } from './tools';
import { buildCrackTextures, buildTextures, buildWaterTexture } from './textures';
import { isTouchDevice, TouchControls } from './touch';
import { World, type EditData, type RayHit } from './world';

const SKY_COLOR = SKY_HORIZON;

// --- 渲染器与场景 ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.domElement.classList.add('game');
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY_COLOR);
const fogFar = RENDER_DISTANCE * CHUNK_SIZE * 0.92;
scene.fog = new THREE.Fog(SKY_COLOR, fogFar * 0.55, fogFar);

const WATER_FOG_COLOR = 0x2456b0;
const JUNGLE_TINT = new THREE.Color(0x7ec98f);
const CORRUPT_TINT = new THREE.Color(0x8f7cb8);
const CRIMSON_TINT = new THREE.Color(0xc4585a);
const waterTintEl = document.getElementById('water-tint')!;
let wasUnderwater = false;

function setUnderwater(on: boolean): void {
  if (on === wasUnderwater) return;
  wasUnderwater = on;
  waterTintEl.classList.toggle('visible', on);
  sky.setVisible(!on); // 水下不见天空
  const fog = scene.fog as THREE.Fog;
  if (on) {
    fog.near = 1;
    fog.far = 22;
  } else {
    fog.near = fogFar * 0.55;
    fog.far = fogFar;
  }
  // 雾色/背景色由主循环按昼夜每帧刷新
}

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  800,
);
camera.rotation.order = 'YXZ';

// --- 纹理与材质 ---
const textures = buildTextures();
const solidMat = new THREE.MeshBasicMaterial({
  map: textures.atlas,
  vertexColors: true,
  alphaTest: 0.5, // 玻璃等镂空纹理
});
// 块光照:顶点属性 aLight(0..1),最终亮度 = max(昼夜, 块光)。
// 昼夜不再乘在材质 color 上,而是走 uniform,火把夜里才能保持亮。
const dayUniform = { value: 1 };
const timeUniform = { value: 0 }; // 树叶随风摇曳的时间
solidMat.onBeforeCompile = (shader) => {
  shader.uniforms.uDay = dayUniform;
  shader.uniforms.uTime = timeUniform;
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      '#include <common>\nattribute float aLight;\nattribute float aSway;\nuniform float uTime;\nvarying float vLight;',
    )
    .replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvLight = aLight;\n' +
        'transformed.x += aSway * 0.05 * sin(uTime * 1.6 + position.x * 0.9 + position.y * 0.55);\n' +
        'transformed.z += aSway * 0.05 * sin(uTime * 1.25 + position.z * 0.85 + position.y * 0.4);',
    );
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uDay;\nvarying float vLight;')
    .replace(
      '#include <color_fragment>',
      '#include <color_fragment>\n  diffuseColor.rgb *= max(uDay, vLight);',
    );
};
const waterTex = buildWaterTexture();
const waterMat = new THREE.MeshBasicMaterial({
  map: waterTex,
  vertexColors: true,
  transparent: true,
  opacity: 0.72,
  depthWrite: false,
  side: THREE.DoubleSide,
});

// --- 世界与玩家(含存档恢复)---
const world = new World(solidMat, waterMat);
scene.add(world.group);

const SAVE_KEY = 'mc-demo-save-v1';
interface SaveData {
  edits: EditData;
  player: { x: number; y: number; z: number; yaw: number; pitch: number; slot: number };
  counts?: Record<string, number>;
  time?: number;
  hotbar?: number[];
  hp?: number;
  creative?: boolean;
}
let saved: SaveData | null = null;
try {
  const raw = localStorage.getItem(SAVE_KEY);
  if (raw) saved = JSON.parse(raw) as SaveData;
} catch {
  saved = null;
}
if (saved) world.loadEdits(saved.edits);

const spawn = world.gen.findSpawn();
const start = saved?.player ?? { x: spawn.x, y: spawn.y, z: spawn.z, yaw: 0, pitch: 0, slot: 0 };
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

// 创造模式(设置里开):飞行观察世界 + 免疫伤害,随存档保存
let creativeMode = saved?.creative === true;
player.creative = creativeMode;

// 灵敏度倍率(设置面板可调,0.5~2,跨会话记忆)
let sensScale = 1;
try {
  const v = parseFloat(localStorage.getItem('mc-demo-sens') ?? '1');
  if (v >= 0.5 && v <= 2) sensScale = v;
} catch {
  // 忽略
}

// 昼夜时间(0..1,0=日出/0.25=正午),随存档保存
let timeOfDay = typeof saved?.time === 'number' ? ((saved.time % 1) + 1) % 1 : 0.22;
let worldBrightness = 1;

let resetting = false; // 清档重开中:阻断一切自动存档写回

function saveGame(): void {
  if (resetting) return;
  try {
    const data: SaveData = {
      edits: world.serializeEdits(),
      player: {
        x: player.pos.x,
        y: player.pos.y,
        z: player.pos.z,
        yaw: player.yaw,
        pitch: player.pitch,
        slot: selectedSlot,
      },
      counts: stats.counts,
      time: timeOfDay,
      hotbar: [...hotbar],
      hp,
      creative: creativeMode,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    world.editsDirty = false;
  } catch {
    // 存储不可用(隐私模式等)时静默跳过
  }
}
window.addEventListener('beforeunload', saveGame);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveGame();
});

// --- 天空(穹顶渐变 + 太阳 + 双层云)---
const sky = new Sky();
scene.add(sky.group);

// --- 选中方块高亮框 ---
const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
  new THREE.LineBasicMaterial({ color: 0x111111 }),
);
highlight.visible = false;
scene.add(highlight);

// --- 挖掘裂纹覆盖层 ---
const crackTextures = buildCrackTextures();
const crackMat = new THREE.MeshBasicMaterial({
  map: crackTextures[0],
  transparent: true,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});
const crack = new THREE.Mesh(new THREE.BoxGeometry(1.002, 1.002, 1.002), crackMat);
crack.visible = false;
scene.add(crack);

// --- 破坏粒子与音效 ---
const particles = new Particles(textures.atlas, world);
scene.add(particles.points);
const sound = new Sound();

// 瀑布落点溅水
world.water.onLanding = (cells) => {
  for (const [x, y, z] of cells) {
    if (Math.hypot(x - player.pos.x, z - player.pos.z) > 48) continue;
    particles.burst(x, y, z, Block.Water, 4);
  }
};

// --- 掉落物 ---
const drops = new ItemDrops(textures.atlas, world);
scene.add(drops.group);

// --- 重力方块(沙子坠落)与水冲火把 ---
const falling = new FallingBlocks(textures.atlas, world);
scene.add(falling.group);
falling.onLand = (x, y, z, id) => sound.place(id);
world.onBlockChanged = (x, y, z) => {
  falling.wake(x, y + 1, z); // 上方失去支撑
  falling.wake(x, y, z); // 悬空放置的重力方块
};
world.water.onWashed = (x, y, z, id) => {
  drops.spawn(x, y, z, id); // 火把被水冲走,掉出可拾取物
  sound.splash();
};

// --- 生物(猪/羊/鸡) ---
const mobs = new Mobs(
  world,
  (x, z) => world.gen.heightAt(x, z),
  (x, y, z) => world.lights.lightAt(x, y, z),
);
scene.add(mobs.group);
mobs.onDeath = (kind, x, y, z) => {
  // 白烟消失(借雪的白色纹理当烟雾)
  particles.burst(Math.floor(x), Math.floor(y), Math.floor(z), Block.Snow, 14);
  sound.mobVoice(kind, 0.9, true);
};
mobs.onVoice = (kind, dist) => sound.mobVoice(kind, Math.max(0.12, 1 - dist / 28));

// --- 玩家生命(10 点 = 5 颗心):僵尸攻击扣血,缓慢回复,归零重生 ---
let hp = typeof saved?.hp === 'number' ? Math.max(1, Math.min(10, saved.hp)) : 10;
let regenTimer = 0;
let deaths = 0;

function respawn(): void {
  deaths++;
  hp = 10;
  player.pos.set(spawn.x, spawn.y + 1, spawn.z);
  player.vel.set(0, 0, 0);
  hud.setHearts(hp);
  hud.toast('你死了,回到出生点');
}

function layerNameOf(y: number): string {
  if (y >= LAYER_SKY_BOTTOM) return '天空层';
  if (y >= LAYER_UNDERGROUND_TOP) return '地表';
  if (y >= LAYER_CAVERN_TOP) return '地下层';
  if (y >= LAYER_HELL_TOP) return '洞穴层';
  return '地狱';
}

function damagePlayer(dmg: number, dirX = 0, dirZ = 0): void {
  if (creativeMode) return; // 创造模式免疫一切伤害
  hp -= dmg;
  if (dirX !== 0 || dirZ !== 0) {
    player.vel.x += dirX * 7;
    player.vel.z += dirZ * 7;
    player.vel.y = Math.max(player.vel.y, 4.5);
  }
  sound.hurt();
  hud.flashDamage();
  hud.setHearts(hp);
  if (hp <= 0) respawn();
}

mobs.onAttack = (dmg, dirX, dirZ) => damagePlayer(dmg, dirX, dirZ);
let lavaTimer = 0;
mobs.onBurning = (x, y, z) => {
  particles.burst(Math.floor(x), Math.floor(y), Math.floor(z), Block.Snow, 5);
};

// --- 玩家模型(第三人称显示,F5/视角按钮切换)---
const model = new PlayerModel();
scene.add(model.group);
let viewMode = 0; // 0=第一人称,1=第三人称背后

let thirdDist = 4; // 第三人称距离,-/= 缩放

function toggleView(): void {
  viewMode = viewMode === 0 ? 1 : 0;
  model.setVisible(viewMode === 1);
  hud.setHandVisible(viewMode === 0);
  hud.toast(viewMode === 1 ? '第三人称视角(-/= 缩放)' : '第一人称视角');
}

// --- 右手持有物:方块小模型 / 工具图标面片,随选中槽位切换 ---
const heldMat = new THREE.MeshBasicMaterial({ map: textures.atlas, alphaTest: 0.5 });
const heldToolMats: THREE.MeshBasicMaterial[] = [];
const heldCache = new Map<number, THREE.Object3D>();
let heldShown = -1;

function heldObjectFor(id: number): THREE.Object3D {
  let obj = heldCache.get(id);
  if (obj) return obj;
  if (isTool(id)) {
    const tex = new THREE.CanvasTexture(textures.toolIconFor(id));
    tex.magFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      alphaTest: 0.4,
      side: THREE.DoubleSide,
    });
    heldToolMats.push(mat);
    // 包一层 Group:内层做斜伸姿态,外层位置由 setHeld 控制
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.46), mat);
    plane.rotation.set(-0.35, 0.95, -0.6); // 从身侧斜伸出,背后视角也能看到
    plane.position.set(0.1, -0.06, -0.08);
    obj = new THREE.Group();
    obj.add(plane);
  } else if (BLOCK_DEFS[id].shape === 'cross') {
    const tex = new THREE.CanvasTexture(textures.iconFor(id));
    tex.magFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      alphaTest: 0.4,
      side: THREE.DoubleSide,
    });
    heldToolMats.push(mat);
    obj = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), mat);
    obj.rotation.set(-0.2, 0.7, -0.3);
  } else {
    obj = new THREE.Mesh(buildBlockGeometry(id, 0.26), heldMat);
    obj.rotation.y = 0.5;
  }
  heldCache.set(id, obj);
  return obj;
}

function syncHeld(): void {
  const want = viewMode === 0 || hotbar[selectedSlot] === Block.Air ? -1 : hotbar[selectedSlot];
  if (want === heldShown) return;
  heldShown = want;
  model.setHeld(want < 0 ? null : heldObjectFor(want));
}

/** 挥手反馈:HUD 手持图标 + 第三人称右臂 */
function swingArm(): void {
  hud.punchHand();
  model.punch();
}

// --- TNT ---
const atlasMat = new THREE.MeshBasicMaterial({ map: textures.atlas });
const tntGeo = buildBlockGeometry(Block.TNT, 0.98);
interface PrimedTnt {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  vy: number;
  fuse: number;
}
const primed: PrimedTnt[] = [];
let shake = 0;

function igniteTnt(x: number, y: number, z: number, fuse = 2.2): void {
  world.setBlock(x, y, z, Block.Air);
  const mat = atlasMat.clone();
  const mesh = new THREE.Mesh(tntGeo, mat);
  mesh.position.set(x + 0.5, y + 0.49, z + 0.5);
  scene.add(mesh);
  primed.push({ mesh, mat, vy: 0, fuse });
  sound.fuse();
}

function detonate(t: PrimedTnt): void {
  const c = t.mesh.position;
  const removed = world.explode(Math.floor(c.x), Math.floor(c.y), Math.floor(c.z), 3.6);
  mobs.applyExplosion(c.x, c.y, c.z, 3.6); // 生物也被波及
  // 碎屑:取一部分被毁方块喷粒子
  let budget = 90;
  for (const [x, y, z, id] of removed) {
    if (id === Block.TNT) {
      // 连锁引爆:短引信
      igniteTnt(x, y, z, 0.25 + Math.random() * 0.5);
      continue;
    }
    if (budget > 0) {
      particles.burst(x, y, z, id, 2);
      budget -= 2;
    }
  }
  // 玩家击退 + 震屏 + 音效按距离衰减
  const toPlayer = new THREE.Vector3(
    player.pos.x - c.x,
    player.pos.y + 0.9 - c.y,
    player.pos.z - c.z,
  );
  const dist = Math.max(toPlayer.length(), 0.5);
  if (dist < 10) {
    const strength = (1 - dist / 10) * 13;
    toPlayer.normalize();
    player.vel.x += toPlayer.x * strength;
    player.vel.y += toPlayer.y * strength * 0.5 + strength * 0.35;
    player.vel.z += toPlayer.z * strength;
  }
  shake = Math.max(shake, Math.min(1, 14 / (dist * dist + 4)));
  sound.explode(Math.max(0.15, Math.min(1, 1 - dist / 42)));
}

function updateTnt(dt: number): void {
  for (let i = primed.length - 1; i >= 0; i--) {
    const t = primed[i];
    t.fuse -= dt;
    // 简单下落:悬空的点燃 TNT 会掉下去
    t.vy -= 24 * dt;
    let ny = t.mesh.position.y + t.vy * dt;
    if (
      t.vy < 0 &&
      world.isSolid(
        Math.floor(t.mesh.position.x),
        Math.floor(ny - 0.49),
        Math.floor(t.mesh.position.z),
      )
    ) {
      ny = Math.floor(ny - 0.49) + 1.49;
      t.vy = 0;
    }
    t.mesh.position.y = ny;
    // 白闪加速 + 临爆膨胀
    const rate = t.fuse < 0.7 ? 0.12 : 0.3;
    const flash = Math.floor(t.fuse / rate) % 2 === 0;
    t.mat.color.setScalar(flash ? 2.4 : worldBrightness);
    if (t.fuse < 0.35) {
      const s = 1 + (0.35 - t.fuse) * 0.5;
      t.mesh.scale.setScalar(s);
    }
    if (t.fuse <= 0) {
      scene.remove(t.mesh);
      t.mat.dispose();
      primed.splice(i, 1);
      detonate(t);
    }
  }
}

// --- HUD 与输入 ---
const hud = new HUD();
const HOTBAR_SIZE = 10;
/** 背包可选物品:全部方块 + 工具 */
const INVENTORY_ITEMS = [...PLACEABLE, ...TOOL_IDS];
// 空槽位图标:透明画布(手持为空手,不显示任何物品)
const BLANK_ICON = document.createElement('canvas');
BLANK_ICON.width = 32;
BLANK_ICON.height = 32;
const slotFor = (id: number) =>
  id === Block.Air
    ? { id: Block.Air, name: '空手', icon: BLANK_ICON }
    : isTool(id)
      ? { id, name: TOOL_DEFS[id].name, icon: textures.toolIconFor(id) }
      : { id, name: BLOCK_DEFS[id].name, icon: textures.iconFor(id) };

// 初始快捷栏:空手起步,仅带剑/镐/斧三件工具,其余为空;背包(E)可取方块放入
const DEFAULT_HOTBAR = [Tool.Sword, Tool.Pickaxe, Tool.Axe, 0, 0, 0, 0, 0, 0, 0];
// 快捷栏:每格存方块/工具 id(0 = 空槽),背包(E)里点选可替换当前槽位,随存档保存
let hotbar: number[] =
  Array.isArray(saved?.hotbar) &&
  saved.hotbar.length === HOTBAR_SIZE &&
  saved.hotbar.every((id) => id === Block.Air || INVENTORY_ITEMS.includes(id))
    ? [...saved.hotbar]
    : [...DEFAULT_HOTBAR];
let selectedSlot = Math.min(Math.max(start.slot, 0), HOTBAR_SIZE - 1);

// 拾取计数(随存档恢复,显示在槽位徽章上)
const stats = { pickups: 0, counts: {} as Record<number, number> };
if (saved?.counts) {
  for (const [k, v] of Object.entries(saved.counts)) stats.counts[Number(k)] = v;
}

function refreshHotbar(): void {
  hud.buildHotbar(hotbar.map(slotFor));
  hud.setSelected(selectedSlot);
  hotbar.forEach((id, i) => hud.setSlotCount(i, stats.counts[id] ?? 0));
}
refreshHotbar();
hud.setHearts(hp);

const input = new Input(renderer.domElement);

// --- 触屏设备:虚拟摇杆 + 手势(点按放置/长按挖掘/拖动视角)+ 按钮 ---
// ?touch 参数可在桌面强制启用,便于调试
const touch =
  isTouchDevice() || new URLSearchParams(location.search).has('touch')
    ? new TouchControls()
    : null;
if (touch) {
  document.body.appendChild(touch.root);
  document.body.classList.add('touch'); // 竖屏提示等 CSS 钩子
  touch.onPause = () => input.forceUnlock();
  touch.onInventory = () => {
    if (inventoryOpen) closeInventory(true);
    else if (input.locked) openInventory();
  };
  touch.onTap = () => tapInteract();
  touch.onView = () => {
    if (input.locked) toggleView();
  };
}

/** 进入游戏:触屏没有指针锁定,直接软锁 */
function engage(): void {
  if (touch) input.forceLock();
  else input.requestLock(() => hud.setOverlayHint('指针锁定被浏览器拒绝,请稍候约 1 秒再点击'));
}

const overlayEl = document.getElementById('overlay')!;
overlayEl.addEventListener('click', () => engage());

// --- 设置面板与教程页签(点击不落入"开始游戏") ---
function setCreative(v: boolean): void {
  creativeMode = v;
  player.creative = v;
  (document.getElementById('opt-creative') as HTMLInputElement).checked = v;
  if (v) hud.toast('创造模式:飞行观察(空格升 / Shift 降)');
  else hud.toast('生存模式');
  saveGame();
}
{
  const tabSettings = document.getElementById('tab-settings')!;
  const tabTutorial = document.getElementById('tab-tutorial')!;
  const paneSettings = document.getElementById('settings-pane')!;
  const paneTutorial = document.getElementById('tutorial-pane')!;
  const showPane = (which: 'settings' | 'tutorial') => {
    paneSettings.classList.toggle('open', which === 'settings');
    paneTutorial.classList.toggle('open', which === 'tutorial');
    tabSettings.classList.toggle('active', which === 'settings');
    tabTutorial.classList.toggle('active', which === 'tutorial');
  };
  tabSettings.addEventListener('click', (e) => {
    e.stopPropagation();
    showPane('settings');
  });
  tabTutorial.addEventListener('click', (e) => {
    e.stopPropagation();
    showPane('tutorial');
  });
  paneSettings.addEventListener('click', (e) => e.stopPropagation());

  const optCreative = document.getElementById('opt-creative') as HTMLInputElement;
  optCreative.checked = creativeMode;
  optCreative.addEventListener('change', () => setCreative(optCreative.checked));

  const optSound = document.getElementById('opt-sound') as HTMLInputElement;
  optSound.checked = !sound.muted;
  optSound.addEventListener('change', () => {
    sound.setMuted(!optSound.checked);
    try {
      localStorage.setItem('mc-demo-muted', sound.muted ? '1' : '0');
    } catch {
      // 忽略
    }
  });

  const optSens = document.getElementById('opt-sens') as HTMLInputElement;
  const optSensVal = document.getElementById('opt-sens-val')!;
  optSens.value = String(sensScale);
  optSensVal.textContent = sensScale.toFixed(1);
  optSens.addEventListener('input', () => {
    sensScale = parseFloat(optSens.value) || 1;
    optSensVal.textContent = sensScale.toFixed(1);
    try {
      localStorage.setItem('mc-demo-sens', String(sensScale));
    } catch {
      // 忽略
    }
  });
}

// 触屏点击物品栏槽位直接选中
hud.onSlotTap = (i) => {
  selectedSlot = i;
  hud.setSelected(i);
};

// 清档重开。此前只摘掉了 beforeunload,但 reload 时页面转为 hidden 会触发
// visibilitychange → saveGame 把旧状态(比如卡在地底的玩家)原样写回,
// 导致"清除存档"无效 —— 现在用 resetting 标志阻断所有自动存档路径。
document.getElementById('reset-save')!.addEventListener('click', (e) => {
  e.stopPropagation();
  resetting = true;
  localStorage.removeItem(SAVE_KEY);
  window.removeEventListener('beforeunload', saveGame);
  location.reload();
});

let started = false;
input.onLockChange = (locked) => {
  if (locked) {
    started = true;
    sound.unlock();
    hud.setOverlayHint('');
    // 重新锁定时背包必然是关闭状态
    inventoryOpen = false;
    hud.setInventoryVisible(false);
  }
  hud.setOverlayVisible(!locked && !inventoryOpen, started);
  if (!locked) {
    sound.setAmbience(0, 0); // 暂停时环境声淡出
    sound.setScape(0, 0);
  }
  leftHeld = false;
  leftDownAt = 0;
  mining = null;
};

input.onSelectSlot = (i) => {
  if (i < HOTBAR_SIZE) {
    selectedSlot = i;
    hud.setSelected(i);
  }
};
input.onWheel = (dir) => {
  selectedSlot = (selectedSlot + dir + HOTBAR_SIZE) % HOTBAR_SIZE;
  hud.setSelected(selectedSlot);
};

// --- 背包(E):点选方块放入当前快捷栏槽位 ---
let inventoryOpen = false;

function openInventory(): void {
  if (inventoryOpen) return;
  inventoryOpen = true;
  leftHeld = false;
  leftDownAt = 0;
  mining = null;
  hud.setInventoryVisible(true);
  // 真实浏览器中释放指针以便点击(测试模式的 forceLock 不受影响)
  if (document.pointerLockElement) document.exitPointerLock();
}

/** relock=false 时(Esc)回到暂停界面而不是重新锁定 */
function closeInventory(relock: boolean): void {
  if (!inventoryOpen) return;
  inventoryOpen = false;
  hud.setInventoryVisible(false);
  if (relock && !input.locked) {
    engage();
  } else if (!relock) {
    hud.setOverlayVisible(!input.locked, started);
  }
}

hud.buildInventory(INVENTORY_ITEMS.map(slotFor), (id) => {
  hotbar[selectedSlot] = id;
  refreshHotbar();
  hud.toast(`${slotFor(id).name} → 槽位 ${(selectedSlot + 1) % 10}`);
  closeInventory(true);
});

// 背包的无键盘退出:点空白背景或右上角 ✕(手机端必需,桌面也顺手)
document.getElementById('inventory')!.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).id === 'inventory') closeInventory(true);
});
document.getElementById('inv-close')!.addEventListener('click', () => closeInventory(true));

// 兜底:游戏中途失锁且无遮罩时,点画布重新锁定
renderer.domElement.addEventListener('click', () => {
  if (!input.locked && !inventoryOpen && started) engage();
});

// --- 方块交互 ---
const eyeVec = new THREE.Vector3();
const dirVec = new THREE.Vector3();

function lookDir(out: THREE.Vector3): THREE.Vector3 {
  const cp = Math.cos(player.pitch);
  return out.set(
    -Math.sin(player.yaw) * cp,
    Math.sin(player.pitch),
    -Math.cos(player.yaw) * cp,
  );
}

function aimHit(): RayHit | null {
  return world.raycast(player.eyePos(eyeVec), lookDir(dirVec), REACH);
}

/** 破坏方块:粒子 + 音效 + 掉落物(朝向变体掉基础方块) */
function breakBlock(hit: RayHit): void {
  world.setBlock(hit.x, hit.y, hit.z, Block.Air);
  particles.burst(hit.x, hit.y, hit.z, hit.id);
  sound.break(hit.id);
  drops.spawn(hit.x, hit.y, hit.z, baseBlock(hit.id));
}

function placeAt(hit: RayHit | null): void {
  if (!hit) return;
  const id = hotbar[selectedSlot];
  if (isTool(id) || id === Block.Air) return; // 工具与空手都不放置方块
  const tx = hit.x + hit.nx;
  const ty = hit.y + hit.ny;
  const tz = hit.z + hit.nz;
  if (Math.hypot(tx + 0.5, tz + 0.5) > WORLD_WALL_RADIUS) return; // 空气墙外禁放
  const cur = world.getBlock(tx, ty, tz);
  if (cur !== Block.Air && !isWater(cur)) return;
  if (player.intersectsBlock(tx, ty, tz)) return;
  // 火把等只能放在实体方块顶面,且不能放进水里
  if (BLOCK_DEFS[id].needsGround && (!world.isSolid(tx, ty - 1, tz) || isWater(cur))) return;
  // 南瓜按放置视角转脸朝向玩家
  const placed = id === Block.Pumpkin ? pumpkinVariant(player.yaw) : id;
  world.setBlock(tx, ty, tz, placed);
  sound.place(placed);
}

function pickAt(hit: RayHit | null): void {
  if (!hit) return;
  const id = baseBlock(hit.id); // 朝向变体按基础方块选取
  let idx = hotbar.indexOf(id);
  if (idx < 0 && PLACEABLE.includes(id)) {
    // 不在快捷栏:创造模式式选取,替换当前槽位
    hotbar[selectedSlot] = id;
    refreshHotbar();
    idx = selectedSlot;
  }
  if (idx >= 0) {
    selectedSlot = idx;
    hud.setSelected(idx);
  }
}

// 挖掘进度状态:按住左键持续累积,移开准星或松手则重置
interface MiningState {
  x: number;
  y: number;
  z: number;
  progress: number;
  total: number;
  hitTimer: number;
}
let mining: MiningState | null = null;
let leftHeld = false;
// 左键点按(<TAP_MS 松开)= 放置,长按 = 挖掘;挖掉方块或打中生物则不再算点按
const TAP_MS = 230;
let leftDownAt = 0;

/** 开箱:宝箱消失,按所在地标喷出战利品 */
function openChest(hit: RayHit): void {
  world.setBlock(hit.x, hit.y, hit.z, Block.Air);
  sound.chest();
  particles.burst(hit.x, hit.y, hit.z, Block.Chest, 14);
  const table = world.gen.structures.lootAt(hit.x, hit.y, hit.z);
  for (const id of CHEST_LOOT[table]) {
    drops.spawn(hit.x, hit.y, hit.z, id);
  }
  hud.toast('开箱!');
}

/** 点按:宝箱开箱;手持打火石对准 TNT 才点燃(因此 TNT 可以互相堆叠),否则放置 */
function useAt(hit: RayHit | null): void {
  const held = hotbar[selectedSlot];
  if (hit && hit.id === Block.Chest) {
    openChest(hit);
    return;
  }
  if (hit && hit.id === Block.TNT && held === Tool.FlintSteel) {
    sound.spark();
    igniteTnt(hit.x, hit.y, hit.z);
    return;
  }
  if (held === Tool.FlintSteel && hit) {
    sound.spark(); // 对非 TNT 擦个火花,没别的效果
    return;
  }
  placeAt(hit); // 工具在 placeAt 内被拒绝
}

/** 触屏点按:作用于十字准星指向处 —— 生物优先挨拳,否则放置/点燃 */
function tapInteract(): void {
  if (!input.locked) return;
  swingArm();
  const origin = player.eyePos(eyeVec);
  const dir = lookDir(dirVec);
  const mhit = mobs.raycast(origin, dir, REACH);
  const bhit = world.raycast(origin, dir, REACH);
  const bdist = bhit
    ? Math.hypot(bhit.x + 0.5 - origin.x, bhit.y + 0.5 - origin.y, bhit.z + 0.5 - origin.z)
    : Infinity;
  if (mhit && mhit.dist < bdist) {
    const sword = hotbar[selectedSlot] === Tool.Sword;
    if (sword) sound.swing();
    sound.mobVoice(mhit.mob.kind, 0.8, true);
    mobs.hurt(mhit, dir, sword ? 2 : 1);
  } else {
    useAt(bhit);
  }
}

input.onMouseDown = (button) => {
  // 触屏统一走手势层;背包打开时的点选不得落入游戏(软锁下 locked 恒真)
  if (touch || inventoryOpen) return;
  if (button === 0) {
    leftHeld = true;
    leftDownAt = performance.now();
    swingArm();
    // 生物比方块近时优先挨拳(打中生物后松开不再触发点按放置)
    const mhit = mobs.raycast(player.eyePos(eyeVec), lookDir(dirVec), REACH);
    if (mhit) {
      const bhit = aimHit();
      const bdist = bhit
        ? Math.hypot(
            bhit.x + 0.5 - eyeVec.x,
            bhit.y + 0.5 - eyeVec.y,
            bhit.z + 0.5 - eyeVec.z,
          )
        : Infinity;
      if (mhit.dist < bdist) {
        const sword = hotbar[selectedSlot] === Tool.Sword;
        if (sword) sound.swing();
        sound.mobVoice(mhit.mob.kind, 0.8, true);
        mobs.hurt(mhit, dirVec, sword ? 2 : 1);
        leftDownAt = 0;
      }
    }
  } else if (button === 1) {
    pickAt(aimHit());
  }
};
input.onMouseUp = (button) => {
  if (touch || inventoryOpen) {
    leftHeld = false;
    leftDownAt = 0;
    return;
  }
  if (button === 0) {
    // 点按:未达长按阈值且没挖掉东西 → 放置
    if (leftDownAt > 0 && performance.now() - leftDownAt < TAP_MS) {
      useAt(aimHit());
      swingArm();
    }
    leftDownAt = 0;
    leftHeld = false;
    mining = null;
  }
};

// 掉落物拾取反馈与计数
const playerCenterVec = new THREE.Vector3();
drops.onPickup = (id) => {
  stats.pickups++;
  stats.counts[id] = (stats.counts[id] ?? 0) + 1;
  const slot = hotbar.indexOf(id);
  if (slot >= 0) hud.setSlotCount(slot, stats.counts[id]);
  sound.pop();
  hud.toast(`+1 ${BLOCK_DEFS[id].name}`);
};

// 静音开关(M),跨会话记忆
try {
  sound.setMuted(localStorage.getItem('mc-demo-muted') === '1');
} catch {
  // 忽略
}
(document.getElementById('opt-sound') as HTMLInputElement).checked = !sound.muted;
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
    if (input.locked) toggleView();
  } else if (code === 'Minus' || code === 'Equal') {
    if (input.locked && viewMode === 1) {
      thirdDist = Math.max(2, Math.min(8, thirdDist + (code === 'Minus' ? 0.5 : -0.5)));
      hud.toast(`视角距离 ${thirdDist.toFixed(1)}`);
    }
  } else if (code === 'KeyE') {
    if (inventoryOpen) closeInventory(true);
    else if (input.locked) openInventory();
  } else if (code === 'Escape' && inventoryOpen) {
    closeInventory(false); // 关背包,回到暂停界面
  }
};

// --- 主循环 ---
const MOUSE_SENS = 0.0022;
let lastTime = performance.now();
let fpsFrames = 0;
let fpsTime = 0;
let fpsValue = 0;
// 脚步 / 落地 / 入水声状态
let stepAcc = 0;
let minFallVy = 0;
let wasAirborne = false;
let wasInWater = false;
let saveTimer = 0;
let splashTimer = 0;
let ambienceTimer = 0;

function blockUnderFeet(): number {
  return world.getBlock(
    Math.floor(player.pos.x),
    Math.floor(player.pos.y - 0.5),
    Math.floor(player.pos.z),
  );
}

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
      minFallVy = 0;
    }
  } else {
    input.consumeLook();
    touch?.consumeLook();
  }

  // 世界推进(暂停时冻结水流)
  world.update(player.pos.x, player.pos.z, input.locked ? dt : 0);

  // 昼夜推进(暂停时冻结);按住 T 或触屏时钟按钮时间快流
  const timeFast = input.isDown('KeyT') || (touch?.timeHeld ?? false);
  if (input.locked) {
    timeOfDay = (timeOfDay + (dt * (timeFast ? 50 : 1)) / DAY_LENGTH) % 1;
  }
  const dn = computeDayNight(timeOfDay);
  // 深度亮度:地下渐暗,洞穴近黑(火把是核心),地狱有岩浆微光
  const pyl = player.pos.y;
  let dayF = dn.brightness;
  if (pyl < LAYER_HELL_TOP + 3) dayF = 0.3;
  else if (pyl < LAYER_CAVERN_TOP) dayF = 0.05;
  else if (pyl < LAYER_UNDERGROUND_TOP) {
    const t = (pyl - LAYER_CAVERN_TOP) / (LAYER_UNDERGROUND_TOP - LAYER_CAVERN_TOP);
    dayF = 0.05 + (dn.brightness - 0.05) * t * t;
  }
  worldBrightness = dayF;
  dayUniform.value = dayF; // 方块亮度走 shader 的 max(深度昼夜, 块光)
  waterMat.color.setScalar(dayF);
  drops.setBrightness(dayF);
  particles.setBrightness(dayF);
  mobs.setBrightness(dayF);
  mobs.nightFactor = dn.starAlpha;
  mobs.daylight = dn.brightness > 0.55;
  // 缓慢回血(4s/点)
  if (hp < 10 && input.locked) {
    regenTimer += dt;
    if (regenTimer >= 4) {
      regenTimer = 0;
      hp = Math.min(10, hp + 1);
      hud.setHearts(hp);
    }
  }
  // 岩浆伤害:身体接触每 0.5s 扣 2 血
  if (input.locked) {
    const inLava =
      world.getBlock(Math.floor(player.pos.x), Math.floor(player.pos.y + 0.2), Math.floor(player.pos.z)) === Block.Lava ||
      world.getBlock(Math.floor(player.pos.x), Math.floor(player.pos.y + 1.2), Math.floor(player.pos.z)) === Block.Lava;
    if (inLava) {
      lavaTimer += dt;
      if (lavaTimer >= 0.5) {
        lavaTimer = 0;
        damagePlayer(2);
      }
    } else {
      lavaTimer = 0;
    }
  }
  falling.setBrightness(dayF);
  model.setBrightness(dayF);
  heldMat.color.setScalar(dayF);
  for (const m of heldToolMats) m.color.setScalar(dayF);
  hud.setHandBrightness(Math.pow(Math.max(dayF, 0.2), 0.45));

  // 周期性存档(有改动才写)
  saveTimer += dt;
  if (saveTimer >= 5) {
    saveTimer = 0;
    if (world.editsDirty) saveGame();
  }

  // 相机跟随(爆炸震屏衰减)
  camera.position.set(player.pos.x, player.pos.y + EYE_HEIGHT, player.pos.z);
  if (shake > 0.003) {
    camera.position.x += (Math.random() - 0.5) * shake * 0.4;
    camera.position.y += (Math.random() - 0.5) * shake * 0.4;
    camera.position.z += (Math.random() - 0.5) * shake * 0.4;
    shake *= Math.exp(-5 * dt);
  }
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;
  if (viewMode === 1) {
    // 第三人称:枢轴抬到眼上方 0.62 格 —— 准星保持屏幕中央,
    // 人物头部明显低于准星不重合;沿视线反方向拉开,撞方块回缩
    const pivot = player.eyePos(eyeVec);
    pivot.y += 0.62;
    camera.position.y += 0.62;
    const back = lookDir(dirVec).multiplyScalar(-1);
    const d = thirdPersonDist(world, pivot, back, thirdDist);
    camera.position.addScaledVector(back, d);
  }

  // 水下氛围
  setUnderwater(
    isWater(
      world.getBlock(
        Math.floor(camera.position.x),
        Math.floor(camera.position.y),
        Math.floor(camera.position.z),
      ),
    ),
  );

  // 雾色/背景色:水下 > 层氛围(地狱/洞穴/地下)> 地表昼夜
  const fog = scene.fog as THREE.Fog;
  const py = player.pos.y;
  if (wasUnderwater) {
    fog.color.set(WATER_FOG_COLOR).multiplyScalar(Math.max(dn.brightness, 0.25));
    fog.near = 1;
    fog.far = 22;
  } else if (py < LAYER_HELL_TOP + 3) {
    fog.color.set(0x2a0c06); // 地狱:暗红热霾
    fog.near = 8;
    fog.far = 56;
  } else if (py < LAYER_CAVERN_TOP) {
    fog.color.set(0x050507); // 洞穴:漆黑
    fog.near = 4;
    fog.far = 34;
  } else if (py < LAYER_UNDERGROUND_TOP) {
    fog.color.set(0x0a0a0d); // 地下:昏暗
    fog.near = 6;
    fog.far = 44;
  } else {
    fog.color.setRGB(...dn.horizon, THREE.SRGBColorSpace);
    // 群系色调:丛林偏绿、腐化偏紫、血腥偏红
    const biome = world.gen.biomeAt(player.pos.x, player.pos.z);
    if (biome === 'jungle') fog.color.lerp(JUNGLE_TINT, 0.22);
    else if (biome === 'corruption') fog.color.lerp(CORRUPT_TINT, 0.3);
    else if (biome === 'crimson') fog.color.lerp(CRIMSON_TINT, 0.3);
    fog.near = fogFar * 0.55;
    fog.far = fogFar;
  }
  (scene.background as THREE.Color).copy(fog.color);
  sky.setVisible(!wasUnderwater && py >= LAYER_UNDERGROUND_TOP);
  // 雾外区块不提交渲染(洞穴/地狱雾距短,省掉大半 draw call)
  world.applyDrawDistance(player.pos.x, player.pos.z, fog.far);

  // 准星目标:高亮 + 挖掘 + 连续放置
  const hit = input.locked
    ? world.raycast(player.eyePos(eyeVec), lookDir(dirVec), REACH)
    : null;
  if (hit) {
    highlight.visible = true;
    highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
  } else {
    highlight.visible = false;
  }

  if (input.locked) {
    // 长按左键/触屏长按:挖掘进度,移开目标即重置。目标一律为十字准星
    // 指向的方块;手持剑不能挖掘(与 MC 一致)。
    const digHit = hit;
    const digActive =
      (leftHeld || (touch?.mineActive ?? false)) && hotbar[selectedSlot] !== Tool.Sword;
    if (digActive && digHit && BLOCK_DEFS[digHit.id].hardness !== Infinity) {
      if (!mining || mining.x !== digHit.x || mining.y !== digHit.y || mining.z !== digHit.z) {
        mining = {
          x: digHit.x,
          y: digHit.y,
          z: digHit.z,
          progress: 0,
          total: BLOCK_DEFS[digHit.id].hardness,
          hitTimer: 0,
        };
      }
      // 镐子对石类、斧头对木类方块 3 倍速
      const digTool = hotbar[selectedSlot];
      const digMat = materialOf(digHit.id);
      const toolBoost =
        (digTool === Tool.Pickaxe && digMat === 'stone') ||
        (digTool === Tool.Axe && digMat === 'wood')
          ? 3
          : 1;
      mining.progress += dt * toolBoost;
      mining.hitTimer -= dt;
      if (mining.hitTimer <= 0) {
        sound.hit(digHit.id);
        swingArm();
        mining.hitTimer = 0.22;
      }
      if (mining.progress >= mining.total) {
        breakBlock(digHit);
        mining = null;
        leftDownAt = 0; // 挖掉了东西,松开不再算点按
      }
    } else {
      mining = null;
    }

    updateTnt(dt);
    drops.update(dt, playerCenterVec.set(player.pos.x, player.pos.y + 0.9, player.pos.z));
    mobs.update(dt, playerCenterVec);
    falling.update(dt);

    // 环境声:风随海拔增强(带阵风起伏),靠近瀑布有流水声,水下屏蔽风声
    ambienceTimer += dt;
    if (ambienceTimer >= 0.3) {
      ambienceTimer = 0;
      const alt = Math.max(0, Math.min(1, (player.pos.y - 32) / 26));
      const gust = 0.72 + 0.28 * Math.sin(now * 0.00042) * Math.sin(now * 0.00019 + 2);
      const wind = wasUnderwater ? 0 : (0.12 + alt * 0.88) * gust;
      const wd = world.water.nearestLandingDist(
        player.pos.x,
        player.pos.y + 1.6,
        player.pos.z,
      );
      const waterAmb = wasUnderwater ? 0.3 : Math.max(0, 1 - wd / 20);
      sound.setAmbience(wind, waterAmb);

      // 声景:地狱低频隆隆(慢起伏),地表腐化之地呜咽
      const py2 = player.pos.y;
      const onSurface = py2 >= LAYER_UNDERGROUND_TOP;
      const biomeNow = onSurface ? world.gen.biomeAt(player.pos.x, player.pos.z) : 'forest';
      const rumble = py2 < LAYER_HELL_TOP + 3 ? 0.42 + 0.16 * Math.sin(now * 0.0006) : 0;
      const eerie =
        onSurface && (biomeNow === 'corruption' || biomeNow === 'crimson')
          ? 0.75 + 0.25 * Math.sin(now * 0.00037)
          : 0;
      sound.setScape(rumble, eerie);
      // 点缀音:白昼林间鸟鸣 / 夜晚蟋蟀 / 地下滴水
      if (!wasUnderwater) {
        const r = Math.random();
        if (onSurface && dn.brightness > 0.55 && biomeNow !== 'corruption' && biomeNow !== 'crimson') {
          if (r < (biomeNow === 'jungle' ? 0.11 : 0.045)) sound.chirp();
        } else if (onSurface && dn.starAlpha > 0.5) {
          if (r < 0.08) sound.cricket();
        } else if (py2 < LAYER_UNDERGROUND_TOP && py2 >= LAYER_HELL_TOP) {
          if (r < (py2 < LAYER_CAVERN_TOP ? 0.06 : 0.035)) sound.drip();
        }
      }
    }

    // 稳定瀑布的持续溅水
    splashTimer += dt;
    if (splashTimer >= 0.28) {
      splashTimer = 0;
      for (const [sx, sy, sz] of world.water.sampleLandings(
        3,
        player.pos.x,
        player.pos.z,
        40,
      )) {
        particles.burst(sx, sy, sz, Block.Water, 3);
      }
      // 地狱:岩浆面升起的余烬火星
      if (player.pos.y < LAYER_HELL_TOP + 3) {
        for (let i = 0; i < 5; i++) {
          const ex = Math.floor(player.pos.x + (Math.random() - 0.5) * 32);
          const ez = Math.floor(player.pos.z + (Math.random() - 0.5) * 32);
          if (
            world.getBlock(ex, LAVA_LEVEL, ez) === Block.Lava &&
            world.getBlock(ex, LAVA_LEVEL + 1, ez) === Block.Air
          ) {
            particles.ember(ex, LAVA_LEVEL + 1, ez);
          }
        }
      }
    }

    // 脚步声
    const speedH = Math.hypot(player.vel.x, player.vel.z);
    const feet = blockUnderFeet();
    if (player.onGround && speedH > 1.5 && !player.isInWater()) {
      stepAcc += speedH * dt;
      if (stepAcc >= 2.2 && feet !== Block.Air) {
        stepAcc = 0;
        sound.step(feet);
      }
    }
    // 落地闷响 + 摔落伤害(约 7 格起步,水中免疫 —— 水里落速被限死)
    if (!player.onGround) {
      minFallVy = Math.min(minFallVy, player.vel.y);
      stepAcc = 1.6;
    } else {
      if (wasAirborne && minFallVy < -9 && feet !== Block.Air) sound.step(feet, 1.8);
      if (wasAirborne && minFallVy < -19 && !player.isInWater()) {
        damagePlayer(Math.min(10, Math.ceil((-minFallVy - 19) / 2.2)));
      }
      minFallVy = 0;
    }
    wasAirborne = !player.onGround;
    // 入水声
    const inWaterNow = player.isInWater();
    if (inWaterNow && !wasInWater) sound.splash();
    wasInWater = inWaterNow;
  }

  // 挖掘裂纹阶段
  if (mining) {
    crack.visible = true;
    crack.position.set(mining.x + 0.5, mining.y + 0.5, mining.z + 0.5);
    const stage = Math.min(4, Math.floor((mining.progress / mining.total) * 5));
    if (crackMat.map !== crackTextures[stage]) crackMat.map = crackTextures[stage];
  } else {
    crack.visible = false;
  }

  particles.update(dt);

  // 疾跑视野拉伸
  const sprinting =
    (input.isDown('ShiftLeft') || input.isDown('ShiftRight') || (touch?.sprintHeld ?? false)) &&
    Math.hypot(player.vel.x, player.vel.z) > 5;
  const targetFov = sprinting ? 82 : 75;
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 10);
    camera.updateProjectionMatrix();
    particles.setViewport(window.innerHeight, camera.projectionMatrix.elements[5]);
  }

  // 玩家模型姿态(仅第三人称可见,更新本身很便宜)
  syncHeld();
  model.update(
    dt,
    player.pos,
    player.yaw,
    player.pitch,
    Math.hypot(player.vel.x, player.vel.z),
    player.isInWater(),
  );

  // 天空跟随与云层漂移
  sky.update(dt, camera.position, dn);

  // 水面缓慢流动 + 轻微晃动;树叶摇曳时钟
  waterTex.offset.x = Math.sin(now * 0.0005) * 0.06;
  waterTex.offset.y = (now * 0.00006) % 1;
  timeUniform.value = (now * 0.001) % 3600;

  // FPS / 调试信息
  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    fpsValue = Math.round(fpsFrames / fpsTime);
    fpsFrames = 0;
    fpsTime = 0;
  }
  const layerName =
    player.pos.y >= LAYER_SKY_BOTTOM
      ? '天空层'
      : player.pos.y >= LAYER_UNDERGROUND_TOP
        ? '地表'
        : player.pos.y >= LAYER_CAVERN_TOP
          ? '地下层'
          : player.pos.y >= LAYER_HELL_TOP
            ? '洞穴层'
            : '地狱';
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
      `时间 ${clockText(timeOfDay)}${touch ? '' : '(按住 T 加速)'}\n` +
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

// 自动化测试模式:跳过指针锁定(无头浏览器不支持),并暴露内部状态供断言
if (new URLSearchParams(location.search).has('test')) {
  input.forceLock();
  (window as unknown as Record<string, unknown>).__game = {
    world,
    player,
    spawn,
    drops,
    stats,
    sound,
    save: saveGame,
    setTime: (v: number) => {
      timeOfDay = ((v % 1) + 1) % 1;
    },
    ui: {
      hotbar: () => [...hotbar],
      selected: () => selectedSlot,
      // 调试:装配任意快捷栏布局 / 取经典方块布局(供 e2e 在清档 reload 后沿用)
      setHotbar: (ids: number[]) => {
        for (let i = 0; i < HOTBAR_SIZE; i++) hotbar[i] = ids[i] ?? Block.Air;
        refreshHotbar();
        syncHeld();
      },
      blockHotbar: () => PLACEABLE.slice(0, HOTBAR_SIZE),
    },
    view: () => viewMode,
    toggleView: () => toggleView(),
    modelVisible: () => model.group.visible,
    heldId: () => heldShown,
    hp: () => hp,
    layer: () => ({ name: layerNameOf(player.pos.y), y: player.pos.y }),
    biome: () => world.gen.biomeAt(player.pos.x, player.pos.z),
    deaths: () => deaths,
    creative: () => creativeMode,
    setCreative: (v: boolean) => setCreative(v),
    structures: () => ({
      tree: world.gen.structures.tree,
      islands: world.gen.structures.islands,
      dungeon: world.gen.structures.dungeon,
      hellForts: world.gen.structures.hellForts,
    }),
    setHp: (v: number) => {
      hp = Math.max(1, Math.min(10, v));
      hud.setHearts(hp);
    },
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
      const s = computeDayNight(timeOfDay);
      const fog = scene.fog as THREE.Fog;
      return {
        time: timeOfDay,
        brightness: s.brightness,
        starAlpha: s.starAlpha,
        fog: [fog.color.r, fog.color.g, fog.color.b],
      };
    },
  };
}

requestAnimationFrame(frame);
