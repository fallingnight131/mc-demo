// 玩家史蒂夫式盒模型:第三人称显示;行走摆臂摆腿、交互挥右臂、头随俯仰
import * as THREE from 'three';
import { buildSteveTextures } from './textures';

interface RayWorld {
  raycast(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number,
  ): { x: number; y: number; z: number } | null;
}

/**
 * 第三人称相机回缩:从眼睛沿视线反方向拉开 maxDist,
 * 途中撞到方块则收到撞点前,避免相机穿墙。
 */
export function thirdPersonDist(
  world: RayWorld,
  eye: THREE.Vector3,
  backDir: THREE.Vector3,
  maxDist: number,
): number {
  const hit = world.raycast(eye, backDir, maxDist);
  if (!hit) return maxDist;
  const d = Math.hypot(hit.x + 0.5 - eye.x, hit.y + 0.5 - eye.y, hit.z + 0.5 - eye.z);
  return Math.max(0.6, d - 0.85);
}

export class PlayerModel {
  readonly group = new THREE.Group();
  private readonly head: THREE.Mesh;
  private readonly armL: THREE.Mesh;
  private readonly armR: THREE.Mesh;
  private readonly legL: THREE.Mesh;
  private readonly legR: THREE.Mesh;
  private readonly mats: THREE.MeshBasicMaterial[];
  private phase = 0;
  private punchT = 0;
  private displayYaw = 0;

  constructor() {
    const skin = buildSteveTextures();
    const mat = (tex: THREE.Texture) => new THREE.MeshBasicMaterial({ map: tex });
    const headMat = mat(skin.head);
    const faceMat = mat(skin.face);
    const bodyMat = mat(skin.body);
    const armMat = mat(skin.arm);
    const legMat = mat(skin.leg);
    this.mats = [headMat, faceMat, bodyMat, armMat, legMat];

    // 比例按 MC:总高约 1.86(碰撞箱 1.8)。前方为局部 -z。
    const box = (w: number, h: number, d: number, pivotTop = false) => {
      const g = new THREE.BoxGeometry(w, h, d);
      if (pivotTop) g.translate(0, -h / 2, 0); // 绕顶端摆动(肩/胯)
      return g;
    };
    // 头(脸在 -z 面)
    this.head = new THREE.Mesh(box(0.46, 0.46, 0.46), [
      headMat,
      headMat,
      headMat,
      headMat,
      headMat,
      faceMat,
    ]);
    this.head.position.y = 1.63;
    this.group.add(this.head);
    const body = new THREE.Mesh(box(0.46, 0.7, 0.24), bodyMat);
    body.position.y = 1.05;
    this.group.add(body);
    const mkLimb = (
      texMat: THREE.MeshBasicMaterial,
      w: number,
      len: number,
      x: number,
      pivotY: number,
    ) => {
      const m = new THREE.Mesh(box(w, len, 0.24, true), texMat);
      m.position.set(x, pivotY, 0);
      this.group.add(m);
      return m;
    };
    this.armL = mkLimb(armMat, 0.22, 0.68, -0.35, 1.38);
    this.armR = mkLimb(armMat, 0.22, 0.68, 0.35, 1.38);
    this.legL = mkLimb(legMat, 0.22, 0.7, -0.12, 0.7);
    this.legR = mkLimb(legMat, 0.22, 0.7, 0.12, 0.7);
    this.group.visible = false;
  }

  /** 放置/挖掘/攻击时挥一下右臂 */
  punch(): void {
    this.punchT = 0.28;
  }

  update(
    dt: number,
    pos: THREE.Vector3,
    yaw: number,
    pitch: number,
    hSpeed: number,
    inWater: boolean,
  ): void {
    this.group.position.copy(pos);
    // 身体朝向平滑追随视角
    let dy = yaw - this.displayYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.displayYaw += dy * Math.min(1, dt * 10);
    this.group.rotation.y = this.displayYaw; // 局部 -z 即前方,与 yaw 约定一致
    // 头俯仰(限制幅度;rotation.x 为正时局部 -z 面朝上 = 抬头)
    this.head.rotation.x = Math.max(-1.1, Math.min(1.1, pitch));

    // 走路摆动:速度越快摆幅越大;水中放缓
    this.phase += hSpeed * dt * (inWater ? 2 : 3.1);
    const amp = Math.min(1, hSpeed / 4.5) * 0.75;
    const s = Math.sin(this.phase) * amp;
    this.legL.rotation.x = s;
    this.legR.rotation.x = -s;
    this.armL.rotation.x = -s * 0.85;
    // 右臂:挥动优先于摆动
    this.punchT = Math.max(0, this.punchT - dt);
    if (this.punchT > 0) {
      const k = this.punchT / 0.28; // 1→0
      this.armR.rotation.x = -Math.sin(k * Math.PI) * 1.7;
    } else {
      this.armR.rotation.x = s * 0.85;
    }
  }

  setBrightness(b: number): void {
    for (const m of this.mats) m.color.setScalar(b);
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }
}
