// 入口:渲染器、场景、游戏循环与交互逻辑的组装
import * as THREE from 'three';
import { Block, BLOCK_DEFS, PLACEABLE } from './blocks';
import { EYE_HEIGHT, REACH, RENDER_DISTANCE, CHUNK_SIZE } from './config';
import { Input } from './controls';
import { HUD } from './hud';
import { Player } from './player';
import { buildCloudTexture, buildTextures } from './textures';
import { World } from './world';

const SKY_COLOR = 0x87ceeb;

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
  const fog = scene.fog as THREE.Fog;
  if (on) {
    fog.color.set(WATER_FOG_COLOR);
    fog.near = 1;
    fog.far = 22;
    (scene.background as THREE.Color).set(WATER_FOG_COLOR);
  } else {
    fog.color.set(SKY_COLOR);
    fog.near = fogFar * 0.55;
    fog.far = fogFar;
    (scene.background as THREE.Color).set(SKY_COLOR);
  }
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
const waterMat = new THREE.MeshBasicMaterial({
  map: textures.atlas,
  vertexColors: true,
  transparent: true,
  opacity: 0.72,
  depthWrite: false,
  side: THREE.DoubleSide,
});

// --- 世界与玩家 ---
const world = new World(solidMat, waterMat);
scene.add(world.group);

const spawn = world.gen.findSpawn();
world.warmup(Math.floor(spawn.x / CHUNK_SIZE), Math.floor(spawn.z / CHUNK_SIZE));

const player = new Player(world);
player.pos.set(spawn.x, spawn.y, spawn.z);

// --- 云层 ---
const cloudTex = buildCloudTexture();
cloudTex.repeat.set(6, 6);
const clouds = new THREE.Mesh(
  new THREE.PlaneGeometry(3000, 3000),
  new THREE.MeshBasicMaterial({
    map: cloudTex,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide,
  }),
);
clouds.rotation.x = -Math.PI / 2;
clouds.position.set(spawn.x, 105, spawn.z);
clouds.renderOrder = 1;
scene.add(clouds);

// --- 选中方块高亮框 ---
const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
  new THREE.LineBasicMaterial({ color: 0x111111 }),
);
highlight.visible = false;
scene.add(highlight);

// --- HUD 与输入 ---
const hud = new HUD();
hud.buildHotbar(
  PLACEABLE.map((id) => ({ id, name: BLOCK_DEFS[id].name, icon: textures.iconFor(id) })),
);
let selectedSlot = 0;
hud.setSelected(selectedSlot);

const input = new Input(renderer.domElement);
const overlayEl = document.getElementById('overlay')!;
overlayEl.addEventListener('click', () => input.requestLock());

let started = false;
input.onLockChange = (locked) => {
  if (locked) started = true;
  hud.setOverlayVisible(!locked, started);
  heldButton = -1;
};

input.onSelectSlot = (i) => {
  if (i < PLACEABLE.length) {
    selectedSlot = i;
    hud.setSelected(i);
  }
};
input.onWheel = (dir) => {
  selectedSlot = (selectedSlot + dir + PLACEABLE.length) % PLACEABLE.length;
  hud.setSelected(selectedSlot);
};

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

function doAction(button: number): void {
  const hit = world.raycast(player.eyePos(eyeVec), lookDir(dirVec), REACH);
  if (!hit) return;

  if (button === 0) {
    // 破坏
    if (hit.id !== Block.Bedrock) world.setBlock(hit.x, hit.y, hit.z, Block.Air);
  } else if (button === 2) {
    // 放置
    const tx = hit.x + hit.nx;
    const ty = hit.y + hit.ny;
    const tz = hit.z + hit.nz;
    const cur = world.getBlock(tx, ty, tz);
    if (cur !== Block.Air && cur !== Block.Water) return;
    if (player.intersectsBlock(tx, ty, tz)) return;
    world.setBlock(tx, ty, tz, PLACEABLE[selectedSlot]);
  } else if (button === 1) {
    // 选取
    const idx = PLACEABLE.indexOf(hit.id);
    if (idx >= 0) {
      selectedSlot = idx;
      hud.setSelected(idx);
    }
  }
}

let heldButton = -1;
let nextRepeat = 0;
input.onMouseDown = (button) => {
  heldButton = button;
  doAction(button);
  nextRepeat = performance.now() + 280;
};
input.onMouseUp = (button) => {
  if (button === heldButton) heldButton = -1;
};

// --- 主循环 ---
const MOUSE_SENS = 0.0022;
let lastTime = performance.now();
let fpsFrames = 0;
let fpsTime = 0;
let fpsValue = 0;

function frame(now: number): void {
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  if (input.locked) {
    const look = input.consumeLook();
    player.yaw -= look.dx * MOUSE_SENS;
    player.pitch -= look.dy * MOUSE_SENS;
    const maxPitch = Math.PI / 2 - 0.001;
    player.pitch = Math.max(-maxPitch, Math.min(maxPitch, player.pitch));

    player.update(dt, {
      forward: (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0),
      strafe: (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0),
      jump: input.isDown('Space'),
      sprint: input.isDown('ShiftLeft') || input.isDown('ShiftRight'),
    });

    // 兜底:跌出世界则传回出生点
    if (player.pos.y < -20) {
      player.pos.set(spawn.x, spawn.y + 2, spawn.z);
      player.vel.set(0, 0, 0);
    }

    if (heldButton >= 0 && now >= nextRepeat) {
      doAction(heldButton);
      nextRepeat = now + (heldButton === 0 ? 180 : 230);
    }
  } else {
    input.consumeLook();
  }

  world.update(player.pos.x, player.pos.z);

  // 相机跟随
  camera.position.set(player.pos.x, player.pos.y + EYE_HEIGHT, player.pos.z);
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;

  // 水下氛围
  setUnderwater(
    world.getBlock(
      Math.floor(camera.position.x),
      Math.floor(camera.position.y),
      Math.floor(camera.position.z),
    ) === Block.Water,
  );

  // 高亮当前准星指向的方块
  const hit = input.locked
    ? world.raycast(player.eyePos(eyeVec), lookDir(dirVec), REACH)
    : null;
  if (hit) {
    highlight.visible = true;
    highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
  } else {
    highlight.visible = false;
  }

  // 云缓慢漂移,跟随玩家平移避免走出边界
  cloudTex.offset.x += dt * 0.0012;
  clouds.position.x = player.pos.x;
  clouds.position.z = player.pos.z;

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
      `XYZ ${player.pos.x.toFixed(1)} / ${player.pos.y.toFixed(1)} / ${player.pos.z.toFixed(1)}`,
  );

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

hud.setOverlayVisible(true, false);

// 自动化测试模式:跳过指针锁定(无头浏览器不支持),并暴露内部状态供断言
if (new URLSearchParams(location.search).has('test')) {
  input.forceLock();
  (window as unknown as Record<string, unknown>).__game = { world, player, spawn };
}

requestAnimationFrame(frame);
