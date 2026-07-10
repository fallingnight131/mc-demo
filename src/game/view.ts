// 系统层 · 视角与玩家模型:第一/第三人称切换、相机跟随(含震屏)、
// 疾跑 FOV、右手持有物模型、挥手反馈
import * as THREE from 'three';
import { buildBlockGeometry } from '../blockmesh';
import { BLOCK_DEFS } from '../blocks';
import { EYE_HEIGHT } from '../config';
import type { HUD } from '../hud';
import type { Inventory } from './inventory';
import type { Particles } from '../particles';
import type { Player } from '../player';
import { PlayerModel, thirdPersonDist } from '../playermodel';
import type { GameTextures } from '../textures';
import type { World } from '../world';

export class View {
  readonly model = new PlayerModel();
  viewMode = 0; // 0=第一人称,1=第三人称背后
  thirdDist = 4; // 第三人称距离,-/= 缩放
  /** 爆炸震屏强度(TNT 系统写入,这里逐帧衰减) */
  shake = 0;
  private heldShown = -1;
  private readonly heldCache = new Map<number, THREE.Object3D>();
  private readonly heldMat: THREE.MeshBasicMaterial;
  private readonly heldToolMats: THREE.MeshBasicMaterial[] = [];
  private readonly eyeVec = new THREE.Vector3();
  private readonly dirVec = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly player: Player,
    private readonly world: World,
    private readonly hud: HUD,
    private readonly textures: GameTextures,
    private readonly inventory: Inventory,
    private readonly particles: Particles,
  ) {
    this.heldMat = new THREE.MeshBasicMaterial({ map: textures.atlas, alphaTest: 0.5 });
  }

  /** 当前第三人称展示的手持物 id(-1 = 无/第一人称),e2e 断言用 */
  get heldId(): number {
    return this.heldShown;
  }

  toggleView(): void {
    this.viewMode = this.viewMode === 0 ? 1 : 0;
    this.model.setVisible(this.viewMode === 1);
    this.hud.setHandVisible(this.viewMode === 0);
    this.hud.toast(this.viewMode === 1 ? '第三人称视角(-/= 缩放)' : '第一人称视角');
  }

  zoom(step: number): void {
    if (this.viewMode !== 1) return;
    this.thirdDist = Math.max(2, Math.min(8, this.thirdDist + step));
    this.hud.toast(`视角距离 ${this.thirdDist.toFixed(1)}`);
  }

  /** 挥手反馈:HUD 手持图标 + 第三人称右臂 */
  swingArm(): void {
    this.hud.punchHand();
    this.model.punch();
  }

  lookDir(out: THREE.Vector3): THREE.Vector3 {
    const cp = Math.cos(this.player.pitch);
    return out.set(
      -Math.sin(this.player.yaw) * cp,
      Math.sin(this.player.pitch),
      -Math.cos(this.player.yaw) * cp,
    );
  }

  private heldObjectFor(id: number): THREE.Object3D {
    let obj = this.heldCache.get(id);
    if (obj) return obj;
    if (id >= 100) {
      const tex = new THREE.CanvasTexture(this.textures.toolIconFor(id));
      tex.magFilter = THREE.NearestFilter;
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.4,
        side: THREE.DoubleSide,
      });
      this.heldToolMats.push(mat);
      // 包一层 Group:内层做斜伸姿态,外层位置由 setHeld 控制
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.46), mat);
      plane.rotation.set(-0.35, 0.95, -0.6); // 从身侧斜伸出,背后视角也能看到
      plane.position.set(0.1, -0.06, -0.08);
      obj = new THREE.Group();
      obj.add(plane);
    } else if (BLOCK_DEFS[id].shape === 'cross') {
      const tex = new THREE.CanvasTexture(this.textures.iconFor(id));
      tex.magFilter = THREE.NearestFilter;
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.4,
        side: THREE.DoubleSide,
      });
      this.heldToolMats.push(mat);
      obj = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), mat);
      obj.rotation.set(-0.2, 0.7, -0.3);
    } else {
      obj = new THREE.Mesh(buildBlockGeometry(id, 0.26), this.heldMat);
      obj.rotation.y = 0.5;
    }
    this.heldCache.set(id, obj);
    return obj;
  }

  private syncHeld(): void {
    const held = this.inventory.heldId();
    const want = this.viewMode === 0 || held === 0 ? -1 : held;
    if (want === this.heldShown) return;
    this.heldShown = want;
    this.model.setHeld(want < 0 ? null : this.heldObjectFor(want));
  }

  setBrightness(b: number): void {
    this.model.setBrightness(b);
    this.heldMat.color.setScalar(b);
    for (const m of this.heldToolMats) m.color.setScalar(b);
    this.hud.setHandBrightness(Math.pow(Math.max(b, 0.2), 0.45));
  }

  /** 相机跟随(含震屏衰减)与第三人称拉距 */
  updateCamera(dt: number): void {
    const p = this.player;
    this.camera.position.set(p.pos.x, p.pos.y + EYE_HEIGHT, p.pos.z);
    if (this.shake > 0.003) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.4;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.4;
      this.camera.position.z += (Math.random() - 0.5) * this.shake * 0.4;
      this.shake *= Math.exp(-5 * dt);
    }
    this.camera.rotation.y = p.yaw;
    this.camera.rotation.x = p.pitch;
    if (this.viewMode === 1) {
      // 第三人称:枢轴抬到眼上方 0.62 格 —— 准星保持屏幕中央,
      // 人物头部明显低于准星不重合;沿视线反方向拉开,撞方块回缩
      const pivot = p.eyePos(this.eyeVec);
      pivot.y += 0.62;
      this.camera.position.y += 0.62;
      const back = this.lookDir(this.dirVec).multiplyScalar(-1);
      const d = thirdPersonDist(this.world, pivot, back, this.thirdDist);
      this.camera.position.addScaledVector(back, d);
    }
  }

  /** 疾跑视野拉伸 + 玩家模型姿态 + 手持物同步 */
  updateModel(dt: number, sprintHeld: boolean): void {
    const p = this.player;
    const speedH = Math.hypot(p.vel.x, p.vel.z);
    const sprinting = sprintHeld && speedH > 5;
    const targetFov = sprinting ? 82 : 75;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 10);
      this.camera.updateProjectionMatrix();
      this.particles.setViewport(window.innerHeight, this.camera.projectionMatrix.elements[5]);
    }
    this.syncHeld();
    this.model.update(dt, p.pos, p.yaw, p.pitch, speedH, p.isInWater());
  }
}
