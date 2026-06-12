import { describe, expect, it } from 'vitest';
import { Block } from '../src/blocks';
import { Player, type BlockWorld, type PlayerInput } from '../src/player';

/** 平地世界:y<=10 为实心;可选竖墙 x=15(y 11..14) */
function flatWorld(withWall = false): BlockWorld {
  return {
    isSolid(x, y, z) {
      void x;
      void z;
      if (y <= 10) return true;
      if (withWall && x === 15 && y <= 14) return true;
      return false;
    },
    getBlock() {
      return Block.Air;
    },
  };
}

const idle: PlayerInput = { forward: 0, strafe: 0, jump: false, sprint: false };

function simulate(p: Player, input: PlayerInput, seconds: number): void {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) p.update(dt, input);
}

describe('player physics', () => {
  it('自由落体后落在地面上', () => {
    const p = new Player(flatWorld());
    p.pos.set(0.5, 20, 0.5);
    simulate(p, idle, 2);
    expect(p.onGround).toBe(true);
    expect(p.pos.y).toBeCloseTo(11, 1);
    expect(p.vel.y).toBe(0);
  });

  it('行走会前进,撞墙会停下', () => {
    const p = new Player(flatWorld(true));
    p.pos.set(0.5, 11.01, 0.5);
    p.yaw = -Math.PI / 2; // 面向 +x
    simulate(p, { ...idle, forward: 1 }, 5);
    // 被 x=15 的墙挡住:玩家半宽 0.3
    expect(p.pos.x).toBeLessThanOrEqual(15 - 0.3 + 0.01);
    expect(p.pos.x).toBeGreaterThan(14);
    expect(p.pos.z).toBeCloseTo(0.5, 1);
  });

  it('跳跃后离地并再次落地', () => {
    const p = new Player(flatWorld());
    p.pos.set(0.5, 11.01, 0.5);
    simulate(p, idle, 0.5);
    expect(p.onGround).toBe(true);
    p.update(1 / 60, { ...idle, jump: true });
    expect(p.onGround).toBe(false);
    expect(p.vel.y).toBeGreaterThan(0);
    let maxY = p.pos.y;
    for (let i = 0; i < 120; i++) {
      p.update(1 / 60, idle);
      maxY = Math.max(maxY, p.pos.y);
    }
    expect(maxY).toBeGreaterThan(12); // 跳起超过 1 格
    expect(maxY).toBeLessThan(13); // 但不超过 2 格
    expect(p.onGround).toBe(true);
  });

  it('天花板会挡住跳跃', () => {
    const w: BlockWorld = {
      isSolid(x, y, z) {
        void x;
        void z;
        return y <= 10 || y === 13;
      },
      getBlock() {
        return Block.Air;
      },
    };
    const p = new Player(w);
    p.pos.set(0.5, 11.01, 0.5);
    simulate(p, idle, 0.3);
    p.update(1 / 60, { ...idle, jump: true });
    simulate(p, idle, 0.5);
    // 头顶 y=13 方块,玩家高 1.8 → 顶到 13-1.8=11.2 附近
    expect(p.pos.y).toBeLessThanOrEqual(13 - 1.8 + 0.01);
  });
});
