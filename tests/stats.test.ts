// 属性表与装备(ARCHITECTURE.md §3.8b):聚合、防御公式、槽型校验、二段跳物理
import { describe, expect, it } from 'vitest';
import { Block } from '../src/blocks';
import { itemDef } from '../src/content/items';
import { canEquipAt } from '../src/game/equipment';
import { applyDefense, BASE_STATS, computeStats } from '../src/game/stats';
import { Equip, Tool } from '../src/tools';
import { Player, type MobilityStats } from '../src/player';

describe('StatSheet 聚合与防御公式', () => {
  it('多来源累加:防御相加、移速加成累加、布尔取或', () => {
    const s = computeStats([
      { defense: 2 },
      { defense: 3, moveSpeed: 0.25 },
      { extraJumps: 1, noFallDamage: true },
    ]);
    expect(s.defense).toBe(5);
    expect(s.moveSpeed).toBeCloseTo(1.25);
    expect(s.extraJumps).toBe(1);
    expect(s.noFallDamage).toBe(true);
    expect(s.maxHp).toBe(10); // 未加成保持基础
    expect(computeStats([])).toEqual(BASE_STATS);
  });

  it('泰拉防御公式:减一半防御,至少 1 点', () => {
    expect(applyDefense(2, 0)).toBe(2);
    expect(applyDefense(2, 2)).toBe(1); // 铁头盔:僵尸 2 → 1
    expect(applyDefense(4, 7)).toBe(1); // 全套铁甲(7):4 → max(1, 0.5→ceil 1)
    expect(applyDefense(10, 4)).toBe(8);
  });

  it('铁甲三件与饰品注册数据齐全,单堆上限 1', () => {
    const helm = itemDef(Equip.IronHelmet)!;
    expect(helm.kind).toBe('armor');
    expect(helm.armor).toEqual({ slot: 'head', defense: 2 });
    expect(helm.maxStack).toBe(1);
    expect(itemDef(Equip.SwiftCharm)?.accessory?.stats.moveSpeed).toBeCloseTo(0.25);
    expect(itemDef(Equip.CloudBottle)?.accessory?.stats.extraJumps).toBe(1);
    expect(itemDef(Equip.Horseshoe)?.accessory?.stats.noFallDamage).toBe(true);
  });

  it('装备槽型校验:盔甲对位,饰品进饰品槽,方块/武器进不了', () => {
    expect(canEquipAt(0, Equip.IronHelmet)).toBe(true);
    expect(canEquipAt(1, Equip.IronHelmet)).toBe(false); // 头盔进不了身槽
    expect(canEquipAt(1, Equip.IronChest)).toBe(true);
    expect(canEquipAt(2, Equip.IronLegs)).toBe(true);
    expect(canEquipAt(3, Equip.SwiftCharm)).toBe(true);
    expect(canEquipAt(7, Equip.Horseshoe)).toBe(true);
    expect(canEquipAt(3, Equip.IronHelmet)).toBe(false); // 盔甲进不了饰品槽
    expect(canEquipAt(0, Block.Stone)).toBe(false);
    expect(canEquipAt(4, Tool.Sword)).toBe(false);
  });
});

describe('二段跳物理(云朵瓶)', () => {
  // 平地世界:y<10 实心
  const flat = {
    isSolid: (_x: number, y: number, _z: number) => y < 10,
    getBlock: () => 0,
  };
  const simJump = (mobility: MobilityStats): number => {
    const p = new Player(flat);
    p.stats = () => mobility;
    p.pos.set(0.5, 10, 0.5);
    const input = { forward: 0, strafe: 0, jump: false, sprint: false };
    let peak = 0;
    const step = (jump: boolean, frames: number) => {
      input.jump = jump;
      for (let i = 0; i < frames; i++) {
        p.update(1 / 60, input);
        peak = Math.max(peak, p.pos.y);
      }
    };
    step(true, 3); // 起跳
    step(false, 18); // 升到接近顶点(8.6/28≈0.31s)
    step(true, 3); // 空中再按 —— 有额外跳则二段跳
    step(false, 60);
    return peak;
  };

  it('extraJumps=1 空中再按跳跃显著高于单跳;无饰品时第二次按无效', () => {
    const single = simJump({ moveSpeed: 1, jumpBoost: 1, extraJumps: 0 });
    const double = simJump({ moveSpeed: 1, jumpBoost: 1, extraJumps: 1 });
    expect(single).toBeLessThan(11.5); // 单跳约 1.3 格
    expect(double).toBeGreaterThan(single + 0.8); // 二段跳明显更高
  });
});
