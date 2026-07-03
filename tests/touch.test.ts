import { describe, expect, it } from 'vitest';
import { stickVector } from '../src/touch';

describe('虚拟摇杆', () => {
  it('死区内不产生移动', () => {
    expect(stickVector(5, -5, 60)).toEqual({ x: 0, y: 0 });
  });

  it('半径内按比例输出', () => {
    const v = stickVector(30, -40, 100);
    expect(v.x).toBeCloseTo(0.3, 5);
    expect(v.y).toBeCloseTo(-0.4, 5);
  });

  it('超出半径截断为单位向量', () => {
    const v = stickVector(300, 400, 60);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 5);
    expect(v.x).toBeCloseTo(0.6, 5);
    expect(v.y).toBeCloseTo(0.8, 5);
  });
});
