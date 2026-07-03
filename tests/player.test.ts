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

  it('水池逃脱:贴岸游泳可以翻上一格高的岸', () => {
    // 地面 y<=10;x>=15 是岸(实体到 y=13,岸面 y=14);x<15 的 y=11..13 为水
    const w: BlockWorld = {
      isSolid(x, y, z) {
        void z;
        if (y <= 10) return true;
        return x >= 15 && y <= 13;
      },
      getBlock(x, y, z) {
        void z;
        if (x < 15 && y >= 11 && y <= 13) return Block.Water;
        return Block.Air;
      },
    };
    const p = new Player(w);
    p.pos.set(12.5, 11.01, 0.5); // 沉在 3 格深的池底
    p.yaw = -Math.PI / 2; // 面向 +x(岸的方向)
    expect(p.isInWater()).toBe(true);
    simulate(p, { forward: 1, strafe: 0, jump: true, sprint: false }, 4);
    // 必须爬上岸:站到 x>15 的岸面(y>=14)之上,且完全脱水
    expect(p.pos.x).toBeGreaterThan(15);
    expect(p.pos.y).toBeGreaterThanOrEqual(13.99);
    expect(p.isTouchingWater()).toBe(false);
  });

  it('深水中按住空格持续上浮', () => {
    const w: BlockWorld = {
      isSolid(x, y, z) {
        void x;
        void z;
        return y <= 10;
      },
      getBlock(x, y, z) {
        void x;
        void z;
        return y >= 11 && y <= 20 ? Block.Water : Block.Air;
      },
    };
    const p = new Player(w);
    p.pos.set(0.5, 11.01, 0.5);
    simulate(p, { ...idle, jump: true }, 3);
    expect(p.pos.y).toBeGreaterThan(18); // 从 10 格深的水底浮到接近水面
  });

  it('水中下沉速度被阻尼限制', () => {
    const w: BlockWorld = {
      isSolid(x, y, z) {
        void x;
        void z;
        return y <= 10;
      },
      getBlock(x, y, z) {
        void x;
        void z;
        return y >= 11 && y <= 20 ? Block.Water : Block.Air;
      },
    };
    const p = new Player(w);
    p.pos.set(0.5, 19, 0.5);
    simulate(p, idle, 1);
    // 自由落体 1 秒会掉 ~14 格;水中限速后只应缓降 2~3.5 格
    expect(p.pos.y).toBeGreaterThan(15.5);
    expect(p.pos.y).toBeLessThan(18);
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
