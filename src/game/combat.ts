// 系统层 · 战斗与生命管线(见 ARCHITECTURE.md §3.6)
// 玩家受伤的唯一入口 hurtPlayer(僵尸/岩浆/摔落/爆炸/未来 boss 弹幕都走这里)、
// 近战攻击结算 meleeAttack(伤害与击退读手持物品的 WeaponDef,不认具体 id)、
// 以及玩家体感(回血/岩浆灼烧/脚步声/落地闷响/摔落伤害/入水声)。
import * as THREE from 'three';
import { Block } from '../blocks';
import { REACH } from '../config';
import { FIST, weaponOf } from '../content/items';
import type { DamageSource, EventBus } from '../core/events';
import type { HUD } from '../hud';
import type { Inventory } from './inventory';
import type { Mobs } from '../mobs';
import type { Player } from '../player';
import type { RayHit, World } from '../world';
import type { Sound } from '../sound';

export const MAX_HP = 10;

export interface MeleeResult {
  /** 是否打中了生物(打中则本次点按不再落到方块交互) */
  attacked: boolean;
  /** 顺路算出的方块命中(供 tap 交互复用,避免重复射线) */
  bhit: RayHit | null;
}

export class Combat {
  hp = MAX_HP;
  deaths = 0;
  private regenTimer = 0;
  private lavaTimer = 0;
  // 脚步 / 落地 / 入水声与摔落伤害的状态
  private stepAcc = 0;
  private minFallVy = 0;
  private wasAirborne = false;
  private wasInWater = false;

  constructor(
    private readonly deps: {
      player: Player;
      world: World;
      mobs: Mobs;
      inventory: Inventory;
      hud: HUD;
      sound: Sound;
      events: EventBus;
      spawn: { x: number; y: number; z: number };
      isCreative(): boolean;
    },
  ) {}

  /** 玩家受伤唯一入口:创造豁免 → 扣血/击退/反馈 → 归零重生 */
  hurtPlayer(dmg: number, source: DamageSource, dirX = 0, dirZ = 0): void {
    const { player, sound, hud, events } = this.deps;
    if (this.deps.isCreative()) return; // 创造模式免疫一切伤害
    this.hp -= dmg;
    if (dirX !== 0 || dirZ !== 0) {
      player.vel.x += dirX * 7;
      player.vel.z += dirZ * 7;
      player.vel.y = Math.max(player.vel.y, 4.5);
    }
    sound.hurt();
    hud.flashDamage();
    hud.setHearts(this.hp);
    events.emit('playerDamaged', { dmg, hp: this.hp, source });
    if (this.hp <= 0) this.respawn(source);
  }

  respawn(source: DamageSource): void {
    const { player, hud, spawn, events } = this.deps;
    this.deaths++;
    this.hp = MAX_HP;
    player.pos.set(spawn.x, spawn.y + 1, spawn.z);
    player.vel.set(0, 0, 0);
    hud.setHearts(this.hp);
    hud.toast('你死了,回到出生点');
    events.emit('playerDied', { source });
    events.emit('playerRespawned', { x: spawn.x, y: spawn.y + 1, z: spawn.z });
  }

  /** 调试接口(__game.setHp) */
  setHp(v: number): void {
    this.hp = Math.max(1, Math.min(MAX_HP, v));
    this.deps.hud.setHearts(this.hp);
  }

  /**
   * 近战攻击:生物比方块近时优先挨打;伤害/击退按手持武器的 WeaponDef 结算。
   * 顺路返回方块命中,供点按交互复用。
   */
  meleeAttack(origin: THREE.Vector3, dir: THREE.Vector3): MeleeResult {
    const { mobs, world, inventory, sound, events } = this.deps;
    const mhit = mobs.raycast(origin, dir, REACH);
    const bhit = world.raycast(origin, dir, REACH);
    if (mhit) {
      const bdist = bhit
        ? Math.hypot(bhit.x + 0.5 - origin.x, bhit.y + 0.5 - origin.y, bhit.z + 0.5 - origin.z)
        : Infinity;
      if (mhit.dist < bdist) {
        const w = weaponOf(inventory.heldId());
        if (w !== FIST) sound.swing();
        sound.mobVoice(mhit.mob.kind, 0.8, true);
        const b = mhit.mob.body;
        events.emit('mobDamaged', {
          kind: mhit.mob.kind,
          x: b.pos.x,
          y: b.pos.y,
          z: b.pos.z,
          hp: mobs.hurt(mhit, dir, w.damage, w.knockback, w.knockUp),
          dmg: w.damage,
        });
        return { attacked: true, bhit };
      }
    }
    return { attacked: false, bhit };
  }

  /** 摔落追踪清零(救援传送等非自然位移时调用,免得落地被记摔伤) */
  clearFallTracking(): void {
    this.minFallVy = 0;
  }

  /** 生命体征:缓慢回血 + 岩浆接触伤害(仅游戏进行中) */
  updateVitals(dt: number, active: boolean): void {
    const { player, world } = this.deps;
    if (this.hp < MAX_HP && active) {
      this.regenTimer += dt;
      if (this.regenTimer >= 4) {
        this.regenTimer = 0;
        this.hp = Math.min(MAX_HP, this.hp + 1);
        this.deps.hud.setHearts(this.hp);
      }
    }
    if (active) {
      const inLava =
        world.getBlock(
          Math.floor(player.pos.x),
          Math.floor(player.pos.y + 0.2),
          Math.floor(player.pos.z),
        ) === Block.Lava ||
        world.getBlock(
          Math.floor(player.pos.x),
          Math.floor(player.pos.y + 1.2),
          Math.floor(player.pos.z),
        ) === Block.Lava;
      if (inLava) {
        this.lavaTimer += dt;
        if (this.lavaTimer >= 0.5) {
          this.lavaTimer = 0;
          this.hurtPlayer(2, 'lava');
        }
      } else {
        this.lavaTimer = 0;
      }
    }
  }

  /** 体感反馈:脚步声、落地闷响、摔落伤害(落水免疫)、入水声 */
  updateBody(dt: number): void {
    const { player, world, sound } = this.deps;
    const speedH = Math.hypot(player.vel.x, player.vel.z);
    const feet = world.getBlock(
      Math.floor(player.pos.x),
      Math.floor(player.pos.y - 0.5),
      Math.floor(player.pos.z),
    );
    if (player.onGround && speedH > 1.5 && !player.isInWater()) {
      this.stepAcc += speedH * dt;
      if (this.stepAcc >= 2.2 && feet !== Block.Air) {
        this.stepAcc = 0;
        sound.step(feet);
      }
    }
    // 落地闷响 + 摔落伤害(约 7 格起步;水中免疫 —— 水里落速被限死)
    if (!player.onGround) {
      this.minFallVy = Math.min(this.minFallVy, player.vel.y);
      this.stepAcc = 1.6;
    } else {
      if (this.wasAirborne && this.minFallVy < -9 && feet !== Block.Air) sound.step(feet, 1.8);
      if (this.wasAirborne && this.minFallVy < -19 && !player.isInWater()) {
        this.hurtPlayer(Math.min(10, Math.ceil((-this.minFallVy - 19) / 2.2)), 'fall');
      }
      this.minFallVy = 0;
    }
    this.wasAirborne = !player.onGround;
    const inWaterNow = player.isInWater();
    if (inWaterNow && !this.wasInWater) sound.splash();
    this.wasInWater = inWaterNow;
  }
}
