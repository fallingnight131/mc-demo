// 系统层 · 库存:快捷栏、背包(stash)、宝箱存储、拾取计数
// 所有权模型(里程碑 54):快捷栏只是"引用",背包 stash 才是拥有的东西 ——
// 生存放置消耗 stash、未拥有不可放置/选取(创造豁免),徽章显示现有数。
// 数据 + HUD 刷新在此;面板开合/指针锁属于 ui/panels,点按分发属于 interact。
import { Block } from '../blocks';
import {
  addToSlots,
  canAddToSlots,
  countInSlots,
  deserializeSlots,
  makeSlots,
  moveStack,
  removeFromSlots,
  serializeSlots,
  type Slot,
} from '../chest';
import {
  catalogItems,
  inventoryItems,
  itemDef,
  itemIcon,
  itemName,
  type IconSource,
} from '../content/items';
import type { EventBus } from '../core/events';
import type { SaveManager } from '../core/save';
import type { HUD, HotbarSlot } from '../hud';
import { CHEST_LOOT } from '../structures';
import { Tool } from '../tools';
import type { World } from '../world';

export const HOTBAR_SIZE = 10;
// 泰拉瑞亚 PC 规格:背包 50 格 / 宝箱 40 格,每堆上限 STACK_MAX(chest.ts)
export const STASH_SIZE = 50;
export const CHEST_SIZE = 40;
// 初始快捷栏:空手起步,仅带剑/镐/斧三件工具(里程碑 41/51)
const DEFAULT_HOTBAR = [Tool.Sword, Tool.Pickaxe, Tool.Axe, 0, 0, 0, 0, 0, 0, 0];

/** 创造模式进入时的完整快照(退出时恢复,序列化形态随存档保存) */
interface CreativeBackup {
  stash: Array<[number, number, number]>;
  hotbar: number[];
  chests: Record<string, Array<[number, number, number]>>;
}

export class Inventory {
  readonly hotbar: number[] = [...DEFAULT_HOTBAR];
  selectedSlot = 0;
  /** 个人背包(泰拉式存储):破坏方块/拾取自动入包 */
  readonly stash: Slot[] = makeSlots(STASH_SIZE);
  /** 宝箱内容(坐标键),首次打开按战利品表填充 */
  readonly chestStore = new Map<string, Slot[]>();
  /** 拾取计数(槽位徽章),随存档保存 */
  readonly stats = { pickups: 0, counts: {} as Record<number, number> };
  openChestKey: string | null = null;
  /** 背包面板点选物品后(装入当前槽位)回调 —— main 接线关闭面板 */
  onInventoryPick: (() => void) | null = null;
  /** 创造模式豁免所有权(main 注入) */
  isCreative: () => boolean = () => false;
  /** 创造模式进入前的快照;非空即"创造隔离生效中"(随存档保存) */
  private creativeBackup: CreativeBackup | null = null;

  constructor(
    private readonly hud: HUD,
    private readonly icons: IconSource,
    private readonly world: World,
    private readonly save: SaveManager,
    private readonly events: EventBus,
  ) {
    // 初始背包只有剑/镐/斧;其余物品靠破坏方块 / 开宝箱收集(存档 load 会整体替换)
    addToSlots(this.stash, Tool.Sword, 1);
    addToSlots(this.stash, Tool.Pickaxe, 1);
    addToSlots(this.stash, Tool.Axe, 1);
  }

  heldId(): number {
    return this.hotbar[this.selectedSlot];
  }

  /** 现有数(所有权):放置/中键选取/徽章都以 stash 为准 */
  ownedCount(id: number): number {
    return countInSlots(this.stash, id);
  }

  /** 背包还能收纳该物品吗(拾取满包守卫;创造无限,恒可) */
  canFit(id: number): boolean {
    return this.isCreative() || canAddToSlots(this.stash, id);
  }

  /** 生存放置消耗一个;返回是否成功(创造模式恒真且不消耗) */
  consume(id: number): boolean {
    if (this.isCreative()) return true;
    if (removeFromSlots(this.stash, id, 1) < 1) return false;
    this.syncHotbarOwnership(); // 耗尽的物品从物品栏消失
    this.refreshBadges();
    if (this.openChestKey) this.refreshChestUI(); // 双栏背包侧数量同步
    return true;
  }

  /** 物品栏只显示背包里真有的东西:现有数归零的槽位清空(创造不清) */
  private syncHotbarOwnership(): void {
    if (this.isCreative()) return;
    let changed = false;
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const id = this.hotbar[i];
      if (id !== Block.Air && this.ownedCount(id) <= 0) {
        this.hotbar[i] = Block.Air;
        changed = true;
      }
    }
    if (changed) this.refreshHotbar();
  }

  /** 载入存档 / 恢复快照后的对账入口(main 在 registerSave 之后调用) */
  syncOwnership(): void {
    this.syncHotbarOwnership();
  }

  /** 全部槽位徽章 = 该物品现有数(方块类才显示 —— 它是会被放置消耗的余量;
   *  工具/武器不堆叠不消耗,不显示;创造模式无限,全部不显示)。 */
  refreshBadges(): void {
    const creative = this.isCreative();
    this.hotbar.forEach((id, i) => {
      const isBlock = !creative && id !== Block.Air && itemDef(id)?.kind === 'block';
      this.hud.setSlotCount(i, isBlock ? this.ownedCount(id) : 0);
    });
  }

  private slotFor(id: number): HotbarSlot {
    return { id, name: itemName(id), icon: itemIcon(this.icons, id) };
  }

  /** 槽位 → 宝箱/背包栏视图(图标 + 名称 + 数量) */
  private slotView(s: Slot) {
    return s ? { id: s.id, count: s.count, name: itemName(s.id), icon: itemIcon(this.icons, s.id) } : null;
  }

  refreshHotbar(): void {
    this.hud.buildHotbar(this.hotbar.map((id) => this.slotFor(id)));
    this.hud.setSelected(this.selectedSlot);
    this.refreshBadges();
  }

  select(i: number): void {
    if (i < 0 || i >= HOTBAR_SIZE) return;
    this.selectedSlot = i;
    this.hud.setSelected(i);
  }

  wheel(dir: number): void {
    this.select((this.selectedSlot + dir + HOTBAR_SIZE) % HOTBAR_SIZE);
  }

  /** 背包点选/中键选取:把物品装入当前槽位 */
  assign(id: number): void {
    this.hotbar[this.selectedSlot] = id;
    this.refreshHotbar();
  }

  /** 中键选取:已在栏内则切过去;否则仅当拥有该方块(或创造模式)才装入当前槽位 */
  pickBlock(id: number): void {
    let idx = this.hotbar.indexOf(id);
    if (idx < 0 && itemDef(id)?.kind === 'block') {
      if (!this.isCreative() && this.ownedCount(id) <= 0) {
        this.hud.toast(`背包里没有「${itemName(id)}」,先去采集`);
        return;
      }
      this.assign(id);
      idx = this.selectedSlot;
    }
    if (idx >= 0) this.select(idx);
  }

  /** 拾取:入背包 + 计数 + 徽章(宝箱开着则同步重绘)。
   *  满包时 drops 的 canPickup 守卫会拦在前面,这里兜底不虚增计数。
   *  创造模式:背包冻结(退出后要恢复原状),掉落物直接消散不入包。 */
  pickup(id: number): boolean {
    if (this.isCreative()) return true;
    if (addToSlots(this.stash, id, 1) > 0) return false; // 背包满:拒收
    this.stats.pickups++;
    this.stats.counts[id] = (this.stats.counts[id] ?? 0) + 1;
    this.refreshBadges();
    if (this.openChestKey) this.refreshChestUI();
    this.events.emit('itemPickedUp', { id, count: 1 });
    return true;
  }

  /** 背包面板(E):生存 = 拥有的物品(带数量);创造 = 全图鉴调色板(无限) */
  refreshInventory(): void {
    const items = this.isCreative()
      ? catalogItems().map((id) => this.slotFor(id))
      : this.stash
          .filter((s): s is NonNullable<Slot> => s !== null)
          // count 交给 HUD 显示 ×N;name/title 保持纯名称
          .map((s) => ({ ...this.slotFor(s.id), count: s.count }));
    this.hud.buildInventory(items, (id) => {
      this.assign(id);
      this.hud.toast(`${itemName(id)} → 槽位 ${(this.selectedSlot + 1) % 10}`);
      this.onInventoryPick?.();
    });
  }

  /** 取宝箱存储;首次访问按所在地标的战利品表生成(开箱与被炸溢出共用) */
  private ensureChestSlots(x: number, y: number, z: number): Slot[] {
    const key = `${x},${y},${z}`;
    let slots = this.chestStore.get(key);
    if (!slots) {
      slots = makeSlots(CHEST_SIZE);
      const table = this.world.gen.structures.lootAt(x, y, z);
      for (const id of CHEST_LOOT[table] ?? []) addToSlots(slots, id, 1);
      this.chestStore.set(key, slots);
    }
    return slots;
  }

  /** 开箱:保留为可反复存取的存储 */
  openChest(x: number, y: number, z: number): void {
    this.ensureChestSlots(x, y, z);
    this.openChestKey = `${x},${y},${z}`;
    this.refreshChestUI();
    this.events.emit('chestOpened', { x, y, z });
  }

  /** 宝箱被摧毁(TNT):取出全部内容物并删除存储;返回内容与"正被打开"标志。
   *  未开过的箱子也先按战利品表生成再溢出 —— 炸箱不吞战利品。 */
  spillChest(x: number, y: number, z: number): { slots: Slot[]; wasOpen: boolean } {
    const key = `${x},${y},${z}`;
    const slots = this.ensureChestSlots(x, y, z);
    this.chestStore.delete(key);
    const wasOpen = this.openChestKey === key;
    if (wasOpen) this.openChestKey = null;
    this.save.markDirty();
    return { slots, wasOpen };
  }

  closeChest(): void {
    this.openChestKey = null;
  }

  /** 重绘宝箱双栏,点击整堆在宝箱与背包间转移 */
  refreshChestUI(): void {
    const slots = this.openChestKey ? this.chestStore.get(this.openChestKey) : null;
    if (!slots) return;
    this.hud.buildChest(
      slots.map((s) => this.slotView(s)),
      this.stash.map((s) => this.slotView(s)),
      (side, i) => {
        if (side === 'chest') moveStack(slots, i, this.stash);
        else moveStack(this.stash, i, slots);
        this.refreshChestUI();
        this.syncHotbarOwnership(); // 全部存进宝箱的物品从物品栏消失
        this.refreshBadges(); // 存取改变拥有数,快捷栏徽章同步
        this.save.markDirty(); // 周期存档持久化宝箱/背包
      },
    );
  }

  /**
   * 创造模式开关(main 的 setCreative 调用;isCreative 已先行翻转):
   * 开 → 快照 stash/快捷栏/全部宝箱,背包变全图鉴无限(类 MC 创造);
   * 关 → 整体恢复快照,回到进入创造之前的状态(创造期间的物品操作不落档)。
   */
  setCreativeMode(on: boolean): void {
    if (on) {
      if (!this.creativeBackup) {
        this.creativeBackup = {
          stash: serializeSlots(this.stash),
          hotbar: [...this.hotbar],
          chests: Object.fromEntries(
            [...this.chestStore].map(([k, v]) => [k, serializeSlots(v)]),
          ),
        };
      }
    } else if (this.creativeBackup) {
      const b = this.creativeBackup;
      this.creativeBackup = null;
      this.stash.splice(0, this.stash.length, ...deserializeSlots(STASH_SIZE, b.stash));
      for (let i = 0; i < HOTBAR_SIZE; i++) this.hotbar[i] = b.hotbar[i] ?? Block.Air;
      this.chestStore.clear();
      for (const [k, v] of Object.entries(b.chests)) {
        this.chestStore.set(k, deserializeSlots(CHEST_SIZE, v));
      }
      this.syncHotbarOwnership(); // 快照本身应自洽,兜底再对一次账
      if (this.openChestKey) this.refreshChestUI();
    }
    this.refreshHotbar();
    this.refreshInventory();
    this.save.markDirty();
  }

  /** 调试:装配任意快捷栏布局(e2e 用) */
  setHotbar(ids: number[]): void {
    for (let i = 0; i < HOTBAR_SIZE; i++) this.hotbar[i] = ids[i] ?? Block.Air;
    this.refreshHotbar();
  }

  /** 调试:把全部物品塞进背包(e2e 从背包取任意方块) */
  giveAll(): void {
    for (const id of inventoryItems()) {
      if (!this.stash.some((s) => s?.id === id)) addToSlots(this.stash, id, 99);
    }
    this.refreshInventory();
  }

  /** 注册存档分节(字段名与历史存档一致:counts/hotbar/stash/chests) */
  registerSave(): void {
    this.save.register('counts', {
      save: () => this.stats.counts,
      load: (d) => {
        if (d && typeof d === 'object') {
          for (const [k, v] of Object.entries(d as Record<string, number>)) {
            if (typeof v === 'number') this.stats.counts[Number(k)] = v;
          }
        }
      },
    });
    this.save.register('hotbar', {
      save: () => [...this.hotbar],
      load: (d) => {
        // 校验按注册表(任何已注册物品都合法):收集到的非 PLACEABLE 方块
        // (丛林草/地狱石等)装进快捷栏后,重载不能把整栏重置掉
        if (
          Array.isArray(d) &&
          d.length === HOTBAR_SIZE &&
          d.every((id) => id === Block.Air || itemDef(id as number) !== undefined)
        ) {
          for (let i = 0; i < HOTBAR_SIZE; i++) this.hotbar[i] = d[i] as number;
        }
      },
    });
    this.save.register('stash', {
      save: () => serializeSlots(this.stash),
      load: (d) => {
        if (d == null) return; // 旧档无背包字段:保留初始剑/镐/斧
        const loaded = deserializeSlots(STASH_SIZE, d);
        this.stash.splice(0, this.stash.length, ...loaded);
      },
    });
    this.save.register('chests', {
      save: () =>
        Object.fromEntries([...this.chestStore].map(([k, v]) => [k, serializeSlots(v)])),
      load: (d) => {
        if (!d || typeof d !== 'object') return;
        for (const [k, v] of Object.entries(d as Record<string, unknown>)) {
          this.chestStore.set(k, deserializeSlots(CHEST_SIZE, v));
        }
      },
    });
    // 创造模式的进入前快照:创造中存档/读档也能在退出时恢复原状
    this.save.register('creativeBackup', {
      save: () => this.creativeBackup,
      load: (d) => {
        if (
          d &&
          typeof d === 'object' &&
          Array.isArray((d as CreativeBackup).stash) &&
          Array.isArray((d as CreativeBackup).hotbar)
        ) {
          const b = d as CreativeBackup;
          this.creativeBackup = {
            stash: b.stash,
            hotbar: b.hotbar,
            chests: b.chests && typeof b.chests === 'object' ? b.chests : {},
          };
        }
      },
    });
  }
}
