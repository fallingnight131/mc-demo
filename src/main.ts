// 入口:渲染器、场景、游戏循环与交互逻辑的组装
import * as THREE from 'three';
import { buildBlockGeometry } from './blockmesh';
import { Block, BLOCK_DEFS, isWater, PLACEABLE } from './blocks';
import { EYE_HEIGHT, REACH, RENDER_DISTANCE, CHUNK_SIZE } from './config';
import { Input } from './controls';
import { clockText, computeDayNight, DAY_LENGTH } from './daynight';
import { HUD } from './hud';
import { ItemDrops } from './items';
import { Mobs, type MobKind } from './mobs';
import { Particles } from './particles';
import { Player } from './player';
import { Sky, SKY_HORIZON } from './sky';
import { Sound } from './sound';
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

// --- 生物(猪/羊/鸡) ---
const mobs = new Mobs(world, (x, z) => world.gen.heightAt(x, z));
scene.add(mobs.group);
mobs.onDeath = (kind, x, y, z) => {
  // 白烟消失(借雪的白色纹理当烟雾)
  particles.burst(Math.floor(x), Math.floor(y), Math.floor(z), Block.Snow, 14);
  sound.mobVoice(kind, 0.9, true);
};
mobs.onVoice = (kind, dist) => sound.mobVoice(kind, Math.max(0.12, 1 - dist / 28));

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
const slotFor = (id: number) => ({ id, name: BLOCK_DEFS[id].name, icon: textures.iconFor(id) });

// 快捷栏:每格存方块 id,背包(E)里点选可替换当前槽位,随存档保存
let hotbar: number[] =
  Array.isArray(saved?.hotbar) &&
  saved.hotbar.length === HOTBAR_SIZE &&
  saved.hotbar.every((id) => PLACEABLE.includes(id))
    ? [...saved.hotbar]
    : PLACEABLE.slice(0, HOTBAR_SIZE);
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
  touch.onTap = (x, y) => tapInteract(x, y);
}

/** 进入游戏:触屏没有指针锁定,直接软锁 */
function engage(): void {
  if (touch) input.forceLock();
  else input.requestLock(() => hud.setOverlayHint('指针锁定被浏览器拒绝,请稍候约 1 秒再点击'));
}

const overlayEl = document.getElementById('overlay')!;
overlayEl.addEventListener('click', () => engage());

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
  if (!locked) sound.setAmbience(0, 0); // 暂停时环境声淡出
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

hud.buildInventory(PLACEABLE.map(slotFor), (id) => {
  hotbar[selectedSlot] = id;
  refreshHotbar();
  hud.toast(`${BLOCK_DEFS[id].name} → 槽位 ${(selectedSlot + 1) % 10}`);
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

/** 破坏方块:粒子 + 音效 + 掉落物 */
function breakBlock(hit: RayHit): void {
  world.setBlock(hit.x, hit.y, hit.z, Block.Air);
  particles.burst(hit.x, hit.y, hit.z, hit.id);
  sound.break(hit.id);
  drops.spawn(hit.x, hit.y, hit.z, hit.id);
}

function placeAt(hit: RayHit | null): void {
  if (!hit) return;
  const tx = hit.x + hit.nx;
  const ty = hit.y + hit.ny;
  const tz = hit.z + hit.nz;
  const cur = world.getBlock(tx, ty, tz);
  if (cur !== Block.Air && !isWater(cur)) return;
  if (player.intersectsBlock(tx, ty, tz)) return;
  const id = hotbar[selectedSlot];
  world.setBlock(tx, ty, tz, id);
  sound.place(id);
}

function pickAt(hit: RayHit | null): void {
  if (!hit) return;
  let idx = hotbar.indexOf(hit.id);
  if (idx < 0 && PLACEABLE.includes(hit.id)) {
    // 不在快捷栏:创造模式式选取,替换当前槽位
    hotbar[selectedSlot] = hit.id;
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

/** 右键/点按:对准 TNT 则点燃,否则放置 */
function useAt(hit: RayHit | null): void {
  if (hit && hit.id === Block.TNT) {
    igniteTnt(hit.x, hit.y, hit.z);
  } else {
    placeAt(hit);
  }
}

/** 屏幕坐标 → 世界射线方向(触屏点按/长按用指尖位置而非准星) */
function screenDir(px: number, py: number, out: THREE.Vector3): THREE.Vector3 {
  out.set((px / window.innerWidth) * 2 - 1, -(py / window.innerHeight) * 2 + 1, 0.5);
  out.unproject(camera);
  return out.sub(camera.position).normalize();
}

/** 触屏点按:指尖处生物优先挨拳,否则放置/点燃 */
function tapInteract(px: number, py: number): void {
  if (!input.locked) return;
  hud.punchHand();
  const dir = screenDir(px, py, dirVec);
  const origin = eyeVec.copy(camera.position);
  const mhit = mobs.raycast(origin, dir, REACH);
  const bhit = world.raycast(origin, dir, REACH);
  const bdist = bhit
    ? Math.hypot(bhit.x + 0.5 - origin.x, bhit.y + 0.5 - origin.y, bhit.z + 0.5 - origin.z)
    : Infinity;
  if (mhit && mhit.dist < bdist) {
    sound.mobVoice(mhit.mob.kind, 0.8, true);
    mobs.hurt(mhit, dir);
  } else {
    useAt(bhit);
  }
}

input.onMouseDown = (button) => {
  if (button === 0) {
    leftHeld = true;
    leftDownAt = performance.now();
    hud.punchHand();
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
        sound.mobVoice(mhit.mob.kind, 0.8, true);
        mobs.hurt(mhit, dirVec);
        leftDownAt = 0;
      }
    }
  } else if (button === 1) {
    pickAt(aimHit());
  }
};
input.onMouseUp = (button) => {
  if (button === 0) {
    // 点按:未达长按阈值且没挖掉东西 → 放置
    if (leftDownAt > 0 && performance.now() - leftDownAt < TAP_MS) {
      useAt(aimHit());
      hud.punchHand();
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
input.onKey = (code) => {
  if (code === 'KeyM') {
    const m = !sound.muted;
    sound.setMuted(m);
    try {
      localStorage.setItem('mc-demo-muted', m ? '1' : '0');
    } catch {
      // 忽略
    }
    hud.toast(m ? '音效:关' : '音效:开');
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
    player.yaw -= lookDx * MOUSE_SENS;
    player.pitch -= lookDy * MOUSE_SENS;
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

    // 兜底:跌出世界则传回出生点
    if (player.pos.y < -20) {
      player.pos.set(spawn.x, spawn.y + 2, spawn.z);
      player.vel.set(0, 0, 0);
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
  worldBrightness = dn.brightness;
  solidMat.color.setScalar(dn.brightness);
  waterMat.color.setScalar(dn.brightness);
  drops.setBrightness(dn.brightness);
  particles.setBrightness(dn.brightness);
  mobs.setBrightness(dn.brightness);
  hud.setHandBrightness(Math.pow(dn.brightness, 0.45));

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

  // 雾色/背景色随昼夜(水下用压暗的水色)
  const fog = scene.fog as THREE.Fog;
  if (wasUnderwater) {
    fog.color.set(WATER_FOG_COLOR).multiplyScalar(Math.max(dn.brightness, 0.25));
  } else {
    fog.color.setRGB(...dn.horizon, THREE.SRGBColorSpace);
  }
  (scene.background as THREE.Color).copy(fog.color);

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
    // 长按左键/触屏长按/挖掘钮:挖掘进度,移开目标即重置。
    // 触屏长按的目标是指尖所指方块(基岩版手势),其余用准星。
    let digHit = hit;
    let digActive = leftHeld;
    if (touch?.mineActive) {
      digHit = world.raycast(
        eyeVec.copy(camera.position),
        screenDir(touch.mineX, touch.mineY, dirVec),
        REACH,
      );
      digActive = true;
    }
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
      mining.progress += dt;
      mining.hitTimer -= dt;
      if (mining.hitTimer <= 0) {
        sound.hit(digHit.id);
        hud.punchHand();
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
    // 落地闷响
    if (!player.onGround) {
      minFallVy = Math.min(minFallVy, player.vel.y);
      stepAcc = 1.6;
    } else {
      if (wasAirborne && minFallVy < -9 && feet !== Block.Air) sound.step(feet, 1.8);
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

  // 天空跟随与云层漂移
  sky.update(dt, camera.position, dn);

  // 水面缓慢流动 + 轻微晃动
  waterTex.offset.x = Math.sin(now * 0.0005) * 0.06;
  waterTex.offset.y = (now * 0.00006) % 1;

  // FPS / 调试信息
  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    fpsValue = Math.round(fpsFrames / fpsTime);
    fpsFrames = 0;
    fpsTime = 0;
  }
  hud.setDebug(
    `FPS ${fpsValue}\n` +
      `XYZ ${player.pos.x.toFixed(1)} / ${player.pos.y.toFixed(1)} / ${player.pos.z.toFixed(1)}\n` +
      `时间 ${clockText(timeOfDay)}${touch ? '' : '(按住 T 加速)'}`,
  );

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
