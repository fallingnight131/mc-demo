import { describe, expect, it } from 'vitest';
import { clockText, computeDayNight, NIGHT_LIGHT } from '../src/daynight';

describe('daynight', () => {
  it('正午:满亮度、无星、太阳高悬、月亮不可见', () => {
    const s = computeDayNight(0.25);
    expect(s.brightness).toBeCloseTo(1, 5);
    expect(s.starAlpha).toBe(0);
    expect(s.sunAlpha).toBe(1);
    expect(s.moonAlpha).toBe(0);
    expect(s.sunDir[1]).toBeGreaterThan(0.85);
  });

  it('午夜:亮度降到月光下限、星月齐现、太阳沉底、夜空显著更暗', () => {
    const s = computeDayNight(0.75);
    expect(s.brightness).toBeCloseTo(NIGHT_LIGHT, 5);
    expect(s.starAlpha).toBe(1);
    expect(s.moonAlpha).toBe(1);
    expect(s.sunAlpha).toBe(0);
    expect(s.sunDir[1]).toBeLessThan(-0.85);
    const day = computeDayNight(0.25);
    expect(s.zenith[2]).toBeLessThan(day.zenith[2] * 0.25);
    expect(s.horizon[1]).toBeLessThan(day.horizon[1] * 0.25);
  });

  it('日落:地平线暖光,亮度随时间单调下降到夜晚', () => {
    const s = computeDayNight(0.5);
    expect(s.glowStrength).toBeGreaterThan(0.5);
    const b = [0.47, 0.5, 0.53].map((t) => computeDayNight(t).brightness);
    expect(b[0]).toBeGreaterThan(b[1]);
    expect(b[1]).toBeGreaterThan(b[2]);
    expect(b[0]).toBeGreaterThan(0.5); // 日落前还亮
    expect(b[2]).toBeCloseTo(NIGHT_LIGHT, 2); // 日落后入夜
  });

  it('太阳与月亮方向相反,且均为单位向量', () => {
    const s = computeDayNight(0.1);
    const dot =
      s.sunDir[0] * s.moonDir[0] + s.sunDir[1] * s.moonDir[1] + s.sunDir[2] * s.moonDir[2];
    expect(dot).toBeCloseTo(-1, 5);
    expect(Math.hypot(...s.sunDir)).toBeCloseTo(1, 5);
  });

  it('时间回绕:t 与 t+1 等价,负数时间也安全', () => {
    const a = computeDayNight(0.3);
    const b = computeDayNight(1.3);
    const c = computeDayNight(-0.7);
    expect(b.brightness).toBeCloseTo(a.brightness, 10);
    expect(b.sunDir[0]).toBeCloseTo(a.sunDir[0], 10);
    expect(c.sunDir[1]).toBeCloseTo(a.sunDir[1], 10);
  });

  it('时钟文本:0→06:00,0.25→12:00,0.75→00:00', () => {
    expect(clockText(0)).toBe('06:00');
    expect(clockText(0.25)).toBe('12:00');
    expect(clockText(0.75)).toBe('00:00');
  });
});
