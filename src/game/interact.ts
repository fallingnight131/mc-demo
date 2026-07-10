// 系统层 · 玩家-世界交互(见 ARCHITECTURE.md §3.7)
// 准星命中、基岩版点按语义(点按 = 交互/放置,长按 = 挖掘)、
// 方块 use 注册表(宝箱/TNT,未来:门/祭坛/恶魔之心)、放置/中键选取/破坏、
// 挖掘进度与裂纹/高亮反馈。伤害结算走 combat,库存走 inventory。
import * as THREE from 'three';
import { baseBlock, Block, BLOCK_DEFS, isWater, pumpkinVariant } from '../blocks';
import { REACH, WORLD_WALL_RADIUS } from '../config';
import { canMineWith, itemDef, miningBoost } from '../content/items';
import type { EventBus } from '../core/events';
import { buildCrackTextures } from '../textures';
import { Tool } from '../tools';
import type { TouchControls } from '../touch';
import type { Combat } from './combat';
import type { Inventory } from './inventory';
import type { ItemDrops } from '../items';
import type { Particles } from '../particles';
import type { Player } from '../player';
import type { RayHit, World } from '../world';
import type { Sound } from '../sound';
import type { Input } from '../controls';

/** 方块点按处理器:返回 true 表示已处理(不再落到放置) */
export type BlockUseHandler = (hit: RayHit) => boolean;

// 左键点按(<TAP_MS 松开)= 交互/放置,长按 = 挖掘;挖掉方块或打中生物则不再算点按
const TAP_MS = 230;

interface MiningState {
  x: number;
  y: number;
  z: number;
  progress: number;
  total: number;
  hitTimer: number;
}

export interface InteractDeps {
  scene: THREE.Scene;
  world: World;
  player: Player;
  inventory: Inventory;
  combat: Combat;
  sound: Sound;
  particles: Particles;
  drops: ItemDrops;
  events: EventBus;
  /** 挥手反馈(HUD 手持图标 + 第三人称右臂) */
  onSwing(): void;
  /** 视线方向(view 提供) */
  lookDir(out: THREE.Vector3): THREE.Vector3;
}

export class Interact {
  private readonly useHandlers = new Map<number, BlockUseHandler>();
  private mining: MiningState | null = null;
  private leftHeld = false;
  private leftDownAt = 0;
  private touch: TouchControls | null = null;

  // 选中方块高亮框 + 挖掘裂纹覆盖层
  private readonly highlight: THREE.LineSegments;
  private readonly crack: THREE.Mesh;
  private readonly crackMat: THREE.MeshBasicMaterial;
  private readonly crackTextures = buildCrackTextures();

  private readonly eyeVec = new THREE.Vector3();
  private readonly dirVec = new THREE.Vector3();

  constructor(private readonly deps: InteractDeps) {
    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
      new THREE.LineBasicMaterial({ color: 0x111111 }),
    );
    this.highlight.visible = false;
    deps.scene.add(this.highlight);

    this.crackMat = new THREE.MeshBasicMaterial({
      map: this.crackTextures[0],
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.002, 1.002, 1.002), this.crackMat);
    this.crack.visible = false;
    deps.scene.add(this.crack);
  }

  /** 注册方块点按行为(宝箱开箱/打火石点 TNT;未来:门/祭坛/恶魔之心) */
  registerBlockUse(blockId: number, handler: BlockUseHandler): void {
    this.useHandlers.set(blockId, handler);
  }

  /** 面板打开 / 失去指针锁时取消进行中的点按与挖掘 */
  cancel(): void {
    this.leftHeld = false;
    this.leftDownAt = 0;
    this.mining = null;
  }

  aimHit(): RayHit | null {
    const { world, player } = this.deps;
    return world.raycast(player.eyePos(this.eyeVec), this.deps.lookDir(this.dirVec), REACH);
  }

  /** 接线鼠标与触屏;uiOpen() 为真时输入不落入游戏(背包/宝箱面板打开) */
  bindInput(input: Input, touch: TouchControls | null, uiOpen: () => boolean): void {
    this.touch = touch;
    input.onMouseDown = (button) => {
      // 触屏统一走手势层;面板打开时的点选不得落入游戏(软锁下 locked 恒真)
      if (touch || uiOpen()) return;
      if (button === 0) {
        this.leftHeld = true;
        this.leftDownAt = performance.now();
        this.deps.onSwing();
        // 生物比方块近时优先挨拳(打中生物后松开不再触发点按放置)
        const { attacked } = this.deps.combat.meleeAttack(
          this.deps.player.eyePos(this.eyeVec),
          this.deps.lookDir(this.dirVec),
        );
        if (attacked) this.leftDownAt = 0;
      } else if (button === 1) {
        this.pickAt(this.aimHit());
      }
    };
    input.onMouseUp = (button) => {
      if (touch || uiOpen()) {
        this.leftHeld = false;
        this.leftDownAt = 0;
        return;
      }
      if (button === 0) {
        // 点按:未达长按阈值且没挖掉东西 → 交互/放置
        if (this.leftDownAt > 0 && performance.now() - this.leftDownAt < TAP_MS) {
          this.useAt(this.aimHit());
          this.deps.onSwing();
        }
        this.leftDownAt = 0;
        this.leftHeld = false;
        this.mining = null;
      }
    };
    if (touch) touch.onTap = () => input.locked && this.tapInteract();
  }

  /** 触屏点按:作用于十字准星指向处 —— 生物优先挨拳,否则交互/放置 */
  tapInteract(): void {
    this.deps.onSwing();
    const origin = this.deps.player.eyePos(this.eyeVec);
    const dir = this.deps.lookDir(this.dirVec);
    const { attacked, bhit } = this.deps.combat.meleeAttack(origin, dir);
    if (!attacked) this.useAt(bhit);
  }

  /** 点按分发:方块 use 注册表 → 打火石擦花 → 放置 */
  useAt(hit: RayHit | null): void {
    if (hit) {
      const handler = this.useHandlers.get(hit.id);
      if (handler && handler(hit)) return;
      if (this.deps.inventory.heldId() === Tool.FlintSteel) {
        this.deps.sound.spark(); // 对非 TNT 擦个火花,没别的效果
        return;
      }
    }
    this.placeAt(hit);
  }

  placeAt(hit: RayHit | null): void {
    if (!hit) return;
    const { world, player, sound, events, inventory } = this.deps;
    const id = inventory.heldId();
    if (itemDef(id)?.kind !== 'block') return; // 工具/武器与空手都不放置方块
    const tx = hit.x + hit.nx;
    const ty = hit.y + hit.ny;
    const tz = hit.z + hit.nz;
    if (Math.hypot(tx + 0.5, tz + 0.5) > WORLD_WALL_RADIUS) return; // 空气墙外禁放
    const cur = world.getBlock(tx, ty, tz);
    if (cur !== Block.Air && !isWater(cur)) return;
    if (player.intersectsBlock(tx, ty, tz)) return;
    // 火把等只能放在实体方块顶面,且不能放进水里
    if (BLOCK_DEFS[id].needsGround && (!world.isSolid(tx, ty - 1, tz) || isWater(cur))) return;
    // 南瓜按放置视角转脸朝向玩家
    const placed = id === Block.Pumpkin ? pumpkinVariant(player.yaw) : id;
    world.setBlock(tx, ty, tz, placed);
    sound.place(placed);
    events.emit('blockPlaced', { x: tx, y: ty, z: tz, id: placed });
  }

  pickAt(hit: RayHit | null): void {
    if (!hit) return;
    this.deps.inventory.pickBlock(baseBlock(hit.id)); // 朝向变体按基础方块选取
  }

  /** 破坏方块:粒子 + 音效 + 掉落物(朝向变体掉基础方块) */
  breakBlock(hit: RayHit): void {
    const { world, particles, sound, drops, events } = this.deps;
    world.setBlock(hit.x, hit.y, hit.z, Block.Air);
    particles.burst(hit.x, hit.y, hit.z, hit.id);
    sound.break(hit.id);
    drops.spawn(hit.x, hit.y, hit.z, baseBlock(hit.id));
    events.emit('blockBroken', { x: hit.x, y: hit.y, z: hit.z, id: hit.id, byPlayer: true });
  }

  /** 每帧:准星高亮 + 长按挖掘进度 + 裂纹阶段 */
  update(dt: number, locked: boolean): void {
    const hit = locked ? this.aimHit() : null;
    if (hit) {
      this.highlight.visible = true;
      this.highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    } else {
      this.highlight.visible = false;
    }

    if (locked) {
      // 长按左键/触屏长按:挖掘进度,移开目标即重置。目标一律为十字准星
      // 指向的方块;手持剑类武器不能挖掘(canMineWith)。
      const held = this.deps.inventory.heldId();
      const digActive =
        (this.leftHeld || (this.touch?.mineActive ?? false)) && canMineWith(held);
      if (digActive && hit && BLOCK_DEFS[hit.id].hardness !== Infinity) {
        if (!this.mining || this.mining.x !== hit.x || this.mining.y !== hit.y || this.mining.z !== hit.z) {
          this.mining = {
            x: hit.x,
            y: hit.y,
            z: hit.z,
            progress: 0,
            total: BLOCK_DEFS[hit.id].hardness,
            hitTimer: 0,
          };
        }
        // 挖掘倍速按注册表结算(镐→石类 / 斧→木类)
        this.mining.progress += dt * miningBoost(held, hit.id);
        this.mining.hitTimer -= dt;
        if (this.mining.hitTimer <= 0) {
          this.deps.sound.hit(hit.id);
          this.deps.onSwing();
          this.mining.hitTimer = 0.22;
        }
        if (this.mining.progress >= this.mining.total) {
          this.breakBlock(hit);
          this.mining = null;
          this.leftDownAt = 0; // 挖掉了东西,松开不再算点按
        }
      } else {
        this.mining = null;
      }
    }

    // 挖掘裂纹阶段
    if (this.mining) {
      this.crack.visible = true;
      this.crack.position.set(this.mining.x + 0.5, this.mining.y + 0.5, this.mining.z + 0.5);
      const stage = Math.min(4, Math.floor((this.mining.progress / this.mining.total) * 5));
      if (this.crackMat.map !== this.crackTextures[stage]) this.crackMat.map = this.crackTextures[stage];
    } else {
      this.crack.visible = false;
    }
  }
}
