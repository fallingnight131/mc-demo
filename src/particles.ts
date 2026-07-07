// 方块破坏粒子:单次 draw call 的点精灵池,采样方块纹理小块
import * as THREE from 'three';
import { ATLAS_COLS, ATLAS_ROWS, Block, BLOCK_DEFS, TILE_PX } from './blocks';

const MAX = 512;
const GRAVITY = 22;
// 采样 4px 小块占图集的 UV 比例(图集非正方形,两轴分开)
const PATCH_U = 4 / (ATLAS_COLS * TILE_PX);
const PATCH_V = 4 / (ATLAS_ROWS * TILE_PX);

interface GroundQuery {
  isSolid(x: number, y: number, z: number): boolean;
}

export class Particles {
  readonly points: THREE.Points;
  private readonly positions = new Float32Array(MAX * 3);
  private readonly uvs = new Float32Array(MAX * 2);
  private readonly sizes = new Float32Array(MAX);
  private readonly alphas = new Float32Array(MAX);
  private readonly vels = new Float32Array(MAX * 3);
  private readonly gravs = new Float32Array(MAX); // 重力系数(碎屑 1,余烬为负=上升)
  private readonly life = new Float32Array(MAX);
  private readonly ttl = new Float32Array(MAX);
  private count = 0;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;

  constructor(atlas: THREE.Texture, private readonly world: GroundQuery) {
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aUv', new THREE.BufferAttribute(this.uvs, 2));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: atlas },
        uScale: { value: 600 },
        uBrightness: { value: 1 },
      },
      vertexShader: `
        attribute vec2 aUv;
        attribute float aSize;
        attribute float aAlpha;
        uniform float uScale;
        varying vec2 vUv;
        varying float vAlpha;
        void main() {
          vUv = aUv;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map;
        uniform float uBrightness;
        varying vec2 vUv;
        varying float vAlpha;
        void main() {
          vec4 c = texture2D(map, vUv + gl_PointCoord * vec2(${PATCH_U}, ${PATCH_V}));
          if (c.a < 0.5 || vAlpha < 0.03) discard;
          gl_FragColor = vec4(c.rgb * 0.85 * uBrightness, vAlpha);
        }`,
      transparent: true,
      depthWrite: false,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  /** 渲染尺寸随窗口变化校准 */
  setViewport(height: number, projection11: number): void {
    this.material.uniforms.uScale.value = (height / 2) * projection11;
  }

  /** 昼夜亮度 */
  setBrightness(b: number): void {
    this.material.uniforms.uBrightness.value = b;
  }

  /** 在被破坏方块位置喷出一簇该方块材质的碎屑 */
  burst(bx: number, by: number, bz: number, blockId: number, count = 20): void {
    const tiles = BLOCK_DEFS[blockId].tiles;
    if (!tiles) return;
    for (let i = 0; i < count; i++) {
      if (this.count >= MAX) return;
      const n = this.count++;
      this.positions[n * 3] = bx + 0.2 + Math.random() * 0.6;
      this.positions[n * 3 + 1] = by + 0.2 + Math.random() * 0.6;
      this.positions[n * 3 + 2] = bz + 0.2 + Math.random() * 0.6;
      this.vels[n * 3] = (Math.random() - 0.5) * 4;
      this.vels[n * 3 + 1] = 2 + Math.random() * 3.5;
      this.vels[n * 3 + 2] = (Math.random() - 0.5) * 4;
      // 随机取一面纹理里的随机小块
      const tile = tiles[(Math.random() * 6) | 0];
      const col = tile % ATLAS_COLS;
      const row = Math.floor(tile / ATLAS_COLS);
      const du = 1 / ATLAS_COLS;
      const dv = 1 / ATLAS_ROWS;
      this.uvs[n * 2] = col * du + Math.random() * (du - PATCH_U);
      this.uvs[n * 2 + 1] = 1 - (row + 1) * dv + Math.random() * (dv - PATCH_V);
      this.sizes[n] = 0.09 + Math.random() * 0.08;
      this.alphas[n] = 1;
      this.gravs[n] = 1;
      this.life[n] = 0;
      this.ttl[n] = 0.45 + Math.random() * 0.35;
    }
  }

  /** 岩浆余烬:从岩浆面缓缓升起的橙色火星(地狱氛围) */
  ember(bx: number, by: number, bz: number): void {
    const tiles = BLOCK_DEFS[Block.Lava].tiles; // 岩浆纹理(橙红)
    if (!tiles || this.count >= MAX - 4) return;
    const n = this.count++;
    this.positions[n * 3] = bx + Math.random();
    this.positions[n * 3 + 1] = by + Math.random() * 0.3;
    this.positions[n * 3 + 2] = bz + Math.random();
    this.vels[n * 3] = (Math.random() - 0.5) * 0.7;
    this.vels[n * 3 + 1] = 1.1 + Math.random() * 1.3;
    this.vels[n * 3 + 2] = (Math.random() - 0.5) * 0.7;
    this.gravs[n] = -0.03; // 热气流:缓缓加速上升
    const tile = tiles[0];
    const col = tile % ATLAS_COLS;
    const row = Math.floor(tile / ATLAS_COLS);
    const du = 1 / ATLAS_COLS;
    const dv = 1 / ATLAS_ROWS;
    this.uvs[n * 2] = col * du + Math.random() * (du - PATCH_U);
    this.uvs[n * 2 + 1] = 1 - (row + 1) * dv + Math.random() * (dv - PATCH_V);
    this.sizes[n] = 0.05 + Math.random() * 0.05;
    this.alphas[n] = 1;
    this.life[n] = 0;
    this.ttl[n] = 1.3 + Math.random() * 0.9;
  }

  update(dt: number): void {
    if (this.count === 0) {
      this.geometry.setDrawRange(0, 0);
      return;
    }
    for (let i = 0; i < this.count; i++) {
      this.life[i] += dt;
      if (this.life[i] >= this.ttl[i]) {
        this.remove(i);
        i--;
        continue;
      }
      const i3 = i * 3;
      this.vels[i3 + 1] -= GRAVITY * this.gravs[i] * dt;
      let nx = this.positions[i3] + this.vels[i3] * dt;
      let ny = this.positions[i3 + 1] + this.vels[i3 + 1] * dt;
      let nz = this.positions[i3 + 2] + this.vels[i3 + 2] * dt;
      // 简单地面碰撞:碎屑落到方块上就停住
      if (
        this.vels[i3 + 1] < 0 &&
        this.world.isSolid(Math.floor(nx), Math.floor(ny - 0.04), Math.floor(nz))
      ) {
        ny = this.positions[i3 + 1];
        this.vels[i3 + 1] = 0;
        this.vels[i3] *= 0.6;
        this.vels[i3 + 2] *= 0.6;
      }
      this.positions[i3] = nx;
      this.positions[i3 + 1] = ny;
      this.positions[i3 + 2] = nz;
      const remain = 1 - this.life[i] / this.ttl[i];
      this.alphas[i] = Math.min(1, remain * 4);
    }
    this.geometry.setDrawRange(0, this.count);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aUv.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
  }

  private remove(i: number): void {
    const last = this.count - 1;
    if (i !== last) {
      this.positions.copyWithin(i * 3, last * 3, last * 3 + 3);
      this.vels.copyWithin(i * 3, last * 3, last * 3 + 3);
      this.uvs.copyWithin(i * 2, last * 2, last * 2 + 2);
      this.sizes[i] = this.sizes[last];
      this.alphas[i] = this.alphas[last];
      this.gravs[i] = this.gravs[last];
      this.life[i] = this.life[last];
      this.ttl[i] = this.ttl[last];
    }
    this.count--;
  }
}
