// 系统层 · 氛围:昼夜推进、深度亮度、雾/背景/水下色调、群系色调、
// 天空跟随、声景(风/流水/地狱隆隆/邪地呜咽/鸟鸣蟋蟀滴水)、
// 瀑布持续溅水与地狱岩浆余烬。深度是泰拉瑞亚的"体感",全在这里。
import * as THREE from 'three';
import { Block, isWater } from '../blocks';
import {
  CHUNK_SIZE,
  LAYER_CAVERN_TOP,
  LAYER_HELL_TOP,
  LAYER_SKY_BOTTOM,
  LAYER_UNDERGROUND_TOP,
  RENDER_DISTANCE,
} from '../config';
import type { SaveSection } from '../core/save';
import { computeDayNight, DAY_LENGTH, type DayNightState } from '../daynight';
import type { WorldMaterials } from '../render/materials';
import type { Particles } from '../particles';
import type { Player } from '../player';
import type { Sky } from '../sky';
import type { Sound } from '../sound';
import type { World } from '../world';

const WATER_FOG_COLOR = 0x2456b0;
const JUNGLE_TINT = new THREE.Color(0x7ec98f);
const CORRUPT_TINT = new THREE.Color(0x8f7cb8);
const CRIMSON_TINT = new THREE.Color(0xc4585a);

/** 垂直分层名(深度计/调试/__game.layer) */
export function layerNameOf(y: number): string {
  if (y >= LAYER_SKY_BOTTOM) return '天空层';
  if (y >= LAYER_UNDERGROUND_TOP) return '地表';
  if (y >= LAYER_CAVERN_TOP) return '地下层';
  if (y >= LAYER_HELL_TOP) return '洞穴层';
  return '地狱';
}

export class Ambience implements SaveSection {
  /** 昼夜时间(0..1,0=日出/0.25=正午),随存档保存 */
  timeOfDay = 0.22;
  /** 当帧昼夜状态(mobs 的夜晚系数、__game.env 用) */
  dn: DayNightState = computeDayNight(0.22);
  /** 深度调制后的世界亮度(分发给各渲染系统) */
  brightness = 1;
  private wasUnderwater = false;
  private readonly fogFar: number;
  private readonly waterTintEl = document.getElementById('water-tint')!;
  private ambienceTimer = 0;
  private splashTimer = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly sky: Sky,
    private readonly world: World,
    private readonly player: Player,
    private readonly sound: Sound,
    private readonly particles: Particles,
    private readonly mats: WorldMaterials,
  ) {
    this.fogFar = RENDER_DISTANCE * CHUNK_SIZE * 0.92;
  }

  setTime(v: number): void {
    this.timeOfDay = ((v % 1) + 1) % 1;
  }

  /** 昼夜推进(暂停冻结,按 T/时钟按钮 ×50)+ 深度亮度 → 返回当帧亮度 */
  updateTime(dt: number, active: boolean, timeFast: boolean): number {
    if (active) {
      this.timeOfDay = (this.timeOfDay + (dt * (timeFast ? 50 : 1)) / DAY_LENGTH) % 1;
    }
    this.dn = computeDayNight(this.timeOfDay);
    // 深度亮度:地下渐暗,洞穴近黑(火把是核心),地狱有岩浆微光
    const py = this.player.pos.y;
    let dayF = this.dn.brightness;
    if (py < LAYER_HELL_TOP + 3) dayF = 0.3;
    else if (py < LAYER_CAVERN_TOP) dayF = 0.05;
    else if (py < LAYER_UNDERGROUND_TOP) {
      const t = (py - LAYER_CAVERN_TOP) / (LAYER_UNDERGROUND_TOP - LAYER_CAVERN_TOP);
      dayF = 0.05 + (this.dn.brightness - 0.05) * t * t;
    }
    this.brightness = dayF;
    this.mats.dayUniform.value = dayF; // 方块亮度走 shader 的 max(深度昼夜, 块光)
    this.mats.waterMat.color.setScalar(dayF);
    return dayF;
  }

  private setUnderwater(on: boolean): void {
    if (on === this.wasUnderwater) return;
    this.wasUnderwater = on;
    this.waterTintEl.classList.toggle('visible', on);
    this.sky.setVisible(!on); // 水下不见天空
    const fog = this.scene.fog as THREE.Fog;
    if (on) {
      fog.near = 1;
      fog.far = 22;
    } else {
      fog.near = this.fogFar * 0.55;
      fog.far = this.fogFar;
    }
  }

  get underwater(): boolean {
    return this.wasUnderwater;
  }

  /** 相机就位后:水下判定、雾/背景分层配色、天空可见性、绘距剔除、
   *  天空跟随、水面漂移与树叶摇曳时钟 */
  applyAtmosphere(dt: number, now: number): void {
    const cam = this.camera;
    this.setUnderwater(
      isWater(
        this.world.getBlock(
          Math.floor(cam.position.x),
          Math.floor(cam.position.y),
          Math.floor(cam.position.z),
        ),
      ),
    );

    // 雾色/背景色:水下 > 层氛围(地狱/洞穴/地下)> 地表昼夜 + 群系色调
    const fog = this.scene.fog as THREE.Fog;
    const py = this.player.pos.y;
    if (this.wasUnderwater) {
      fog.color.set(WATER_FOG_COLOR).multiplyScalar(Math.max(this.dn.brightness, 0.25));
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
      fog.color.setRGB(...this.dn.horizon, THREE.SRGBColorSpace);
      // 群系色调:丛林偏绿、腐化偏紫、血腥偏红
      const biome = this.world.gen.biomeAt(this.player.pos.x, this.player.pos.z);
      if (biome === 'jungle') fog.color.lerp(JUNGLE_TINT, 0.22);
      else if (biome === 'corruption') fog.color.lerp(CORRUPT_TINT, 0.3);
      else if (biome === 'crimson') fog.color.lerp(CRIMSON_TINT, 0.3);
      fog.near = this.fogFar * 0.55;
      fog.far = this.fogFar;
    }
    (this.scene.background as THREE.Color).copy(fog.color);
    this.sky.setVisible(!this.wasUnderwater && py >= LAYER_UNDERGROUND_TOP);
    // 雾外区块不提交渲染(洞穴/地狱雾距短,省掉大半 draw call)
    this.world.applyDrawDistance(this.player.pos.x, this.player.pos.z, fog.far);

    // 天空跟随与云层漂移
    this.sky.update(dt, cam.position, this.dn);
    // 水面缓慢流动 + 轻微晃动;树叶摇曳时钟
    this.mats.waterTex.offset.x = Math.sin(now * 0.0005) * 0.06;
    this.mats.waterTex.offset.y = (now * 0.00006) % 1;
    this.mats.timeUniform.value = (now * 0.001) % 3600;
  }

  /** 声景与点缀(仅游戏进行中):风/流水环境声、层与群系声景、
   *  鸟鸣蟋蟀滴水、瀑布持续溅水、地狱岩浆余烬 */
  updateSounds(dt: number, now: number): void {
    const { player, world, sound, particles } = this;
    this.ambienceTimer += dt;
    if (this.ambienceTimer >= 0.3) {
      this.ambienceTimer = 0;
      const alt = Math.max(0, Math.min(1, (player.pos.y - 32) / 26));
      const gust = 0.72 + 0.28 * Math.sin(now * 0.00042) * Math.sin(now * 0.00019 + 2);
      const wind = this.wasUnderwater ? 0 : (0.12 + alt * 0.88) * gust;
      const wd = world.water.nearestLandingDist(player.pos.x, player.pos.y + 1.6, player.pos.z);
      const waterAmb = this.wasUnderwater ? 0.3 : Math.max(0, 1 - wd / 20);
      sound.setAmbience(wind, waterAmb);

      // 声景:地狱低频隆隆(慢起伏),地表腐化/血腥之地呜咽
      const py = player.pos.y;
      const onSurface = py >= LAYER_UNDERGROUND_TOP;
      const biomeNow = onSurface ? world.gen.biomeAt(player.pos.x, player.pos.z) : 'forest';
      const rumble = py < LAYER_HELL_TOP + 3 ? 0.42 + 0.16 * Math.sin(now * 0.0006) : 0;
      const eerie =
        onSurface && (biomeNow === 'corruption' || biomeNow === 'crimson')
          ? 0.75 + 0.25 * Math.sin(now * 0.00037)
          : 0;
      sound.setScape(rumble, eerie);
      // 点缀音:白昼林间鸟鸣 / 夜晚蟋蟀 / 地下滴水
      if (!this.wasUnderwater) {
        const r = Math.random();
        if (
          onSurface &&
          this.dn.brightness > 0.55 &&
          biomeNow !== 'corruption' &&
          biomeNow !== 'crimson'
        ) {
          if (r < (biomeNow === 'jungle' ? 0.11 : 0.045)) sound.chirp();
        } else if (onSurface && this.dn.starAlpha > 0.5) {
          if (r < 0.08) sound.cricket();
        } else if (py < LAYER_UNDERGROUND_TOP && py >= LAYER_HELL_TOP) {
          if (r < (py < LAYER_CAVERN_TOP ? 0.06 : 0.035)) sound.drip();
        }
      }
    }

    // 稳定瀑布的持续溅水
    this.splashTimer += dt;
    if (this.splashTimer >= 0.28) {
      this.splashTimer = 0;
      for (const [sx, sy, sz] of world.water.sampleLandings(3, player.pos.x, player.pos.z, 40)) {
        particles.burst(sx, sy, sz, Block.Water, 3);
      }
      // 地狱:岩浆面升起的余烬火星
      if (player.pos.y < LAYER_HELL_TOP + 3) {
        for (let i = 0; i < 5; i++) {
          const ex = Math.floor(player.pos.x + (Math.random() - 0.5) * 32);
          const ez = Math.floor(player.pos.z + (Math.random() - 0.5) * 32);
          const ly = world.gen.hellLava(ex, ez); // 本区域岩浆液面(高低不一)
          if (
            world.getBlock(ex, ly, ez) === Block.Lava &&
            world.getBlock(ex, ly + 1, ez) === Block.Air
          ) {
            particles.ember(ex, ly + 1, ez);
          }
        }
      }
    }
  }

  // 存档分节 'time'
  save(): unknown {
    return this.timeOfDay;
  }

  load(data: unknown): void {
    if (typeof data === 'number') this.timeOfDay = ((data % 1) + 1) % 1;
  }
}
