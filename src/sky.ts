// 天空:渐变穹顶 + 昼夜循环的日月星辰 + 双层漂移云
// 穹顶用原始 sRGB 色值直接输出(ShaderMaterial 不走色彩管理管线),
// 地平线色与场景雾色一致,保证远处地形无缝隐入天际。
import * as THREE from 'three';
import type { DayNightState } from './daynight';
import { mulberry32 } from './noise';
import { buildCloudTexture, buildMoonTexture, buildSunTexture } from './textures';

export const SKY_ZENITH = 0x5288e0;
export const SKY_HORIZON = 0xaed9f2;

const STAR_COUNT = 420;

function rawColor(hex: number): THREE.Color {
  // 跳过工作色彩空间转换,着色器中原样输出
  return new THREE.Color().setHex(hex, THREE.NoColorSpace);
}

export class Sky {
  readonly group = new THREE.Group();
  private readonly dome: THREE.Mesh;
  private readonly domeMat: THREE.ShaderMaterial;
  private readonly sun: THREE.Mesh;
  private readonly sunMat: THREE.MeshBasicMaterial;
  private readonly moon: THREE.Mesh;
  private readonly moonMat: THREE.MeshBasicMaterial;
  private readonly starGroup = new THREE.Group();
  private readonly starMat: THREE.PointsMaterial;
  private readonly cloudLow: THREE.Mesh;
  private readonly cloudHigh: THREE.Mesh;
  private readonly cloudLowMat: THREE.MeshBasicMaterial;
  private readonly cloudHighMat: THREE.MeshBasicMaterial;
  private readonly cloudLowTex: THREE.Texture;
  private readonly cloudHighTex: THREE.Texture;
  private readonly tmp = new THREE.Vector3();

  constructor() {
    this.domeMat = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: rawColor(SKY_ZENITH) },
        horizonColor: { value: rawColor(SKY_HORIZON) },
        glowColor: { value: rawColor(0xff9a3c) },
        glowStrength: { value: 0 },
        sunDir: { value: new THREE.Vector3(1, 0, -0.3) },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 glowColor;
        uniform float glowStrength;
        uniform vec3 sunDir;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(horizonColor, topColor, smoothstep(0.02, 0.5, h));
          // 日出日落:朝太阳方向的地平线染上暖光
          float toSun = max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(sunDir.x, 0.0, sunDir.z))), 0.0);
          float band = 1.0 - smoothstep(0.0, 0.38, abs(h - 0.02));
          col = mix(col, glowColor, glowStrength * band * pow(toSun, 3.0));
          // 地平线以下渐暗,营造纵深
          col *= 1.0 - 0.14 * smoothstep(-0.04, -0.5, h);
          gl_FragColor = vec4(col, 1.0);
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(460, 24, 16), this.domeMat);
    this.dome.renderOrder = -10; // 先于一切绘制
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    // 星空:固定在随太阳旋转的天球上,夜里淡入
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(STAR_COUNT * 3);
    const starCol = new Float32Array(STAR_COUNT * 3);
    const rng = mulberry32(20260613);
    for (let i = 0; i < STAR_COUNT; i++) {
      // 均匀球面分布
      const u = rng() * 2 - 1;
      const phi = rng() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      starPos[i * 3] = Math.cos(phi) * r * 450;
      starPos[i * 3 + 1] = u * 450;
      starPos[i * 3 + 2] = Math.sin(phi) * r * 450;
      const lum = 0.35 + rng() * 0.65;
      const warm = rng() < 0.25 ? 0.92 : 1; // 少数星星偏暖
      starCol[i * 3] = lum;
      starCol[i * 3 + 1] = lum * (warm === 1 ? 1 : 0.9);
      starCol[i * 3 + 2] = lum * warm;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(starCol, 3));
    this.starMat = new THREE.PointsMaterial({
      size: 1.9,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const stars = new THREE.Points(starGeo, this.starMat);
    stars.frustumCulled = false;
    stars.renderOrder = -9;
    this.starGroup.add(stars);
    this.group.add(this.starGroup);

    const makeBillboard = (
      tex: THREE.Texture,
      size: number,
    ): [THREE.Mesh, THREE.MeshBasicMaterial] => {
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
      mesh.renderOrder = -8;
      this.group.add(mesh);
      return [mesh, mat];
    };
    [this.sun, this.sunMat] = makeBillboard(buildSunTexture(), 64);
    [this.moon, this.moonMat] = makeBillboard(buildMoonTexture(), 44);

    const makeCloudPlane = (
      tex: THREE.Texture,
      y: number,
      repeat: number,
      opacity: number,
    ): [THREE.Mesh, THREE.MeshBasicMaterial] => {
      tex.repeat.set(repeat, repeat);
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity,
        depthWrite: false,
        fog: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3200, 3200), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = y;
      mesh.renderOrder = 1;
      this.group.add(mesh);
      return [mesh, mat];
    };
    this.cloudLowTex = buildCloudTexture(424242);
    this.cloudHighTex = buildCloudTexture(777001);
    // 云层在天空岛(y≈190..206)之上,Phase 2 抬升世界后同步上移
    [this.cloudLow, this.cloudLowMat] = makeCloudPlane(this.cloudLowTex, 212, 6, 0.82);
    [this.cloudHigh, this.cloudHighMat] = makeCloudPlane(this.cloudHighTex, 236, 3.2, 0.4);
  }

  /** 每帧:穹顶/日月星辰跟随相机与时间,云层漂移并水平跟随玩家 */
  update(dt: number, camPos: THREE.Vector3, st: DayNightState): void {
    this.dome.position.copy(camPos);
    const u = this.domeMat.uniforms;
    (u.topColor.value as THREE.Color).setRGB(...st.zenith, THREE.NoColorSpace);
    (u.horizonColor.value as THREE.Color).setRGB(...st.horizon, THREE.NoColorSpace);
    (u.glowColor.value as THREE.Color).setRGB(...st.glow, THREE.NoColorSpace);
    u.glowStrength.value = st.glowStrength;
    (u.sunDir.value as THREE.Vector3).set(...st.sunDir);

    this.sun.position
      .copy(camPos)
      .addScaledVector(this.tmp.set(...st.sunDir), 430);
    this.sun.lookAt(camPos);
    this.sunMat.opacity = st.sunAlpha;
    this.sun.visible = st.sunAlpha > 0.01;
    this.moon.position
      .copy(camPos)
      .addScaledVector(this.tmp.set(...st.moonDir), 430);
    this.moon.lookAt(camPos);
    this.moonMat.opacity = st.moonAlpha;
    this.moon.visible = st.moonAlpha > 0.01;

    this.starGroup.position.copy(camPos);
    this.starGroup.rotation.z = st.sunAngle;
    this.starMat.opacity = st.starAlpha;
    this.starGroup.visible = st.starAlpha > 0.01;

    this.cloudLowMat.color.setRGB(...st.cloudTint, THREE.NoColorSpace);
    this.cloudHighMat.color.setRGB(...st.cloudTint, THREE.NoColorSpace);
    this.cloudLowTex.offset.x += dt * 0.0014;
    this.cloudHighTex.offset.x += dt * 0.0006;
    this.cloudHighTex.offset.y += dt * 0.0002;
    this.cloudLow.position.x = camPos.x;
    this.cloudLow.position.z = camPos.z;
    this.cloudHigh.position.x = camPos.x;
    this.cloudHigh.position.z = camPos.z;
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }
}
