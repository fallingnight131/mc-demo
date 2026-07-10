// 实体层:EntityManager 生命周期 + 弹幕物理与命中(ARCHITECTURE.md §3.5)
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EntityManager, type Entity } from '../src/game/entities';
import {
  Projectiles,
  type BlockRaycaster,
  type TargetHit,
  type Targets,
} from '../src/game/projectiles';

const noBlocks: BlockRaycaster = { raycast: () => null };
const noTargets: Targets = { raycast: () => null, hurt: () => 0 };

function makeTargetAtX(planeX: number) {
  const hits: Array<{ dmg: number; knock: number; knockUp: number }> = [];
  const targets: Targets = {
    raycast: (origin, dir, maxDist) => {
      if (Math.abs(dir.x) < 1e-9) return null;
      const t = (planeX - origin.x) / dir.x;
      return t >= 0 && t <= maxDist ? { dist: t } : null;
    },
    hurt: (_hit: TargetHit, _dir, dmg, knock, knockUp) => {
      hits.push({ dmg, knock, knockUp });
      return 0;
    },
  };
  return { targets, hits };
}

describe('entity manager', () => {
  it('update 返回 false 即 dispose 并移除;亮度广播到位', () => {
    const log: string[] = [];
    let bright = 0;
    const make = (life: number): Entity => ({
      update: (dt) => (life -= dt) > 0,
      dispose: () => log.push('dispose'),
      setBrightness: (b) => (bright = b),
    });
    const em = new EntityManager();
    em.add(make(0.05));
    em.add(make(1));
    em.setBrightness(0.4);
    expect(bright).toBe(0.4);
    em.update(0.1);
    expect(em.count).toBe(1);
    expect(log).toEqual(['dispose']);
    em.clear();
    expect(em.count).toBe(0);
  });
});

describe('projectiles', () => {
  it('直线飞行,寿命到点消亡', () => {
    const em = new EntityManager();
    const pj = new Projectiles(noBlocks, noTargets, em);
    pj.spawn(new THREE.Vector3(0, 10, 0), new THREE.Vector3(10, 0, 0), {
      damage: 3, knockback: 5, knockUp: 3, gravity: 0, life: 0.5,
    });
    expect(pj.count).toBe(1);
    for (let i = 0; i < 4; i++) em.update(0.1); // 0.4s:仍存活,飞 4 格
    expect(pj.count).toBe(1);
    em.update(0.2); // 超过寿命
    expect(pj.count).toBe(0);
  });

  it('重力弹道:垂直速度按 gravity 递减(会下坠)', () => {
    const em = new EntityManager();
    const pj = new Projectiles(noBlocks, noTargets, em);
    const mesh = new THREE.Object3D();
    pj.spawn(new THREE.Vector3(0, 50, 0), new THREE.Vector3(6, 0, 0), {
      damage: 1, knockback: 0, knockUp: 0, gravity: 28, life: 5, mesh,
    });
    for (let i = 0; i < 60; i++) em.update(1 / 60); // 1 秒
    expect(mesh.position.x).toBeGreaterThan(5.5); // 前进 ~6 格
    expect(mesh.position.y).toBeLessThan(50 - 10); // 1s 自由落体 ~14 格
  });

  it('命中生物:按 spec 结算伤害与击退,非穿透即消失;穿透则继续飞', () => {
    const em = new EntityManager();
    const plain = makeTargetAtX(2);
    const pj = new Projectiles(noBlocks, plain.targets, em);
    let hitAt = -1;
    pj.spawn(new THREE.Vector3(0, 10, 0), new THREE.Vector3(20, 0, 0), {
      damage: 7, knockback: 9, knockUp: 4, gravity: 0, life: 2,
      onHitMob: (x) => (hitAt = x),
    });
    for (let i = 0; i < 6; i++) em.update(0.05);
    expect(plain.hits).toEqual([{ dmg: 7, knock: 9, knockUp: 4 }]);
    expect(hitAt).toBeCloseTo(2, 1);
    expect(pj.count).toBe(0);

    // 穿透弹:命中后不消失(泰拉之刃剑气可穿多目标)
    const pierce = makeTargetAtX(2);
    const pj2 = new Projectiles(noBlocks, pierce.targets, em);
    pj2.spawn(new THREE.Vector3(0, 10, 0), new THREE.Vector3(20, 0, 0), {
      damage: 2, knockback: 1, knockUp: 1, gravity: 0, life: 2, pierce: true,
    });
    em.update(0.2); // 一步跨过 x=2
    expect(pierce.hits.length).toBe(1);
    expect(pj2.count).toBe(1);
  });

  it('命中方块即止(回调报告位置)', () => {
    const em = new EntityManager();
    const wall: BlockRaycaster = {
      raycast: (origin, dir, maxDist) => {
        if (dir.x <= 0) return null;
        const t = (5 - origin.x) / dir.x;
        return t >= 0 && t <= maxDist ? { x: 5, y: 10, z: 0 } : null;
      },
    };
    const pj = new Projectiles(wall, noTargets, em);
    let blockHit: number[] | null = null;
    pj.spawn(new THREE.Vector3(0, 10.5, 0.5), new THREE.Vector3(30, 0, 0), {
      damage: 1, knockback: 0, knockUp: 0, gravity: 0, life: 3,
      onHitBlock: (x, y, z) => (blockHit = [x, y, z]),
    });
    for (let i = 0; i < 10; i++) em.update(0.05);
    expect(blockHit).toEqual([5, 10, 0]);
    expect(pj.count).toBe(0);
  });
});
