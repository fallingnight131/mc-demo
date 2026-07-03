// 昼夜循环:把一天中的时间 t(0..1)映射为太阳方向、天空配色、
// 世界亮度与星月透明度。纯计算、不依赖 three,便于单元测试。
//
// 时间约定:t=0 日出、t=0.25 正午、t=0.5 日落、t=0.75 午夜。
// 太阳沿绕 Z 轴的大圆运动,整体向 -z 倾斜避免正顶死角。

export const DAY_LENGTH = 480; // 一个完整昼夜(秒)
export const NIGHT_LIGHT = 0.12; // 夜晚方块亮度下限(月光)

export type Vec3 = [number, number, number];

export interface DayNightState {
  /** 太阳方向(单位向量,夜里位于地平线下) */
  sunDir: Vec3;
  /** 月亮方向(与太阳相反) */
  moonDir: Vec3;
  /** 太阳沿轨道的角度(弧度),星空随之旋转 */
  sunAngle: number;
  /** 穹顶顶色(原始 sRGB,0..1) */
  zenith: Vec3;
  /** 地平线色,同时用作雾色与背景色 */
  horizon: Vec3;
  /** 日出日落时太阳方向的地平线暖光色 */
  glow: Vec3;
  glowStrength: number;
  /** 世界亮度乘数(NIGHT_LIGHT..1),乘在所有方块材质上 */
  brightness: number;
  starAlpha: number;
  sunAlpha: number;
  moonAlpha: number;
  /** 云的颜色(夜里压暗,黄昏偏暖) */
  cloudTint: Vec3;
}

const hex = (h: number): Vec3 => [
  ((h >> 16) & 255) / 255,
  ((h >> 8) & 255) / 255,
  (h & 255) / 255,
];

const DAY_ZENITH = hex(0x5288e0);
const DAY_HORIZON = hex(0xaed9f2);
const DUSK_ZENITH = hex(0x2f3f74);
const DUSK_HORIZON = hex(0xc98a58);
const NIGHT_ZENITH = hex(0x05080f);
const NIGHT_HORIZON = hex(0x10182b);
const GLOW = hex(0xff9a3c);

function smoothstep(e0: number, e1: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** 三段调色板按权重混合(day + dusk + night = 1) */
function blend3(day: number, dusk: number, night: number, d: Vec3, k: Vec3, n: Vec3): Vec3 {
  return [
    d[0] * day + k[0] * dusk + n[0] * night,
    d[1] * day + k[1] * dusk + n[1] * night,
    d[2] * day + k[2] * dusk + n[2] * night,
  ];
}

export function computeDayNight(time: number): DayNightState {
  const t = ((time % 1) + 1) % 1;
  const a = t * Math.PI * 2;
  const len = Math.hypot(Math.cos(a), Math.sin(a), 0.32);
  const sunDir: Vec3 = [Math.cos(a) / len, Math.sin(a) / len, -0.32 / len];
  const moonDir: Vec3 = [-sunDir[0], -sunDir[1], -sunDir[2]];
  const e = sunDir[1]; // 太阳高度

  const day = smoothstep(0.04, 0.34, e);
  const night = smoothstep(0.08, 0.3, -e);
  const dusk = Math.max(0, 1 - day - night);

  const glowStrength = (1 - smoothstep(0.02, 0.26, Math.abs(e))) * 0.9;
  const brightness = NIGHT_LIGHT + (1 - NIGHT_LIGHT) * smoothstep(-0.1, 0.3, e);

  // 云:白天纯白,夜里压暗,黄昏染上暖色
  const cloudBase = 0.32 + 0.68 * smoothstep(-0.12, 0.22, e);
  const cloudTint: Vec3 = [
    cloudBase,
    cloudBase * (1 - glowStrength * 0.22),
    cloudBase * (1 - glowStrength * 0.4),
  ];

  return {
    sunDir,
    moonDir,
    sunAngle: a,
    zenith: blend3(day, dusk, night, DAY_ZENITH, DUSK_ZENITH, NIGHT_ZENITH),
    horizon: blend3(day, dusk, night, DAY_HORIZON, DUSK_HORIZON, NIGHT_HORIZON),
    glow: GLOW,
    glowStrength,
    brightness,
    starAlpha: smoothstep(0.05, 0.24, -e),
    sunAlpha: smoothstep(-0.14, -0.03, e),
    moonAlpha: smoothstep(0.02, 0.14, -e),
    cloudTint,
  };
}

/** 一天中的时钟文本(t=0 → 06:00) */
export function clockText(time: number): string {
  const h24 = (((time % 1) + 1) % 1) * 24 + 6;
  const hh = Math.floor(h24) % 24;
  const mm = Math.floor((h24 % 1) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
