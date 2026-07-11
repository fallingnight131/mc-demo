// 系统层 · 库存(泰拉瑞亚 PC 模型,里程碑 56):
// 统一 50 格实体存储 —— 槽 0..9 就是物品栏(快捷栏),槽 10..49 是背包,
// 外加 1 格丢弃栏。物品栏不再是"引用":同一物品自然只占一格
// (除非玩家右键拆堆),放置消耗的是手中这一堆。
// E 面板 = 完整网格(物品栏行 + 背包 + 丢弃栏),格子间点击拿起/放下拖运;
// 创造模式 E 面板是全图鉴调色板(点选装入当前槽),背包快照隔离、退出恢复。
import { Block } from '../blocks';
import {
  addToSlots,
  canAddToSlots,
  countInSlots,
  deserializeSlots,
  dropToSlot,
  liftFromSlot,
  makeSlots,
  moveStack,
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
import type { BagArea, BagSlotView, HUD, HotbarSlot } from '../hud';
import { CHEST_LOOT } from '../structures';
import { Tool } from '../tools';
import type { World } from '../world';

export const HOTBAR_SIZE = 10;
/** 泰拉瑞亚 PC 规格:总 50 格(物品栏 10 + 背包 40),宝箱 40 格 */
export const SLOTS_SIZE = 50;
export const CHEST_SIZE = 40;

/** 创造模式进入时的完整快照(退出时恢复,序列化形态随存档保存) */
interface CreativeBackup {
  slots: Array<[number, number, number]>;
  trash: [number, number, number] | null;
  chests: Record<string, Array<[number, number, number]>>;
  /** 旧档形态(里程碑 55 前):迁移用 */
  stash?: Array<[number, number, number]>;
  hotbar?: number[];
}

/** 初始装备:剑/镐/斧各一,占物品栏前三格 */
function defaultSlots(): Slot[] {
  const slots = makeSlots(SLOTS_SIZE);
  slots[0] = { id: Tool.Sword, count: 1 };
  slots[1] = { id: Tool.Pickaxe, count: 1 };
  slots[2] = { id: Tool.Axe, count: 1 };
  return slots;
}

/**
 * 旧档迁移(引用式快捷栏 + stash → 统一实体槽):
 * 快捷栏引用按序领取 stash 里对应的堆(同 id 的重复引用只有第一个拿到 ——
 * "同一物品占多格"的旧 bug 在迁移时顺手去重),其余堆按序填入背包区。
 */
export function migrateLegacySlots(hotbarIds: unknown, stashData: unknown): Slot[] {
  const legacy = deserializeSlots(SLOTS_SIZE, stashData);
  const out = makeSlots(SLOTS_SIZE);
  const ids = Array.isArray(hotbarIds) ? (hotbarIds as number[]) : [];
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    const id = ids[i];
    if (typeof id !== 'number' || id <= 0) continue;
    const j = legacy.findIndex((s) => s?.id === id);
    if (j >= 0) {
      out[i] = legacy[j];
      legacy[j] = null;
    }
  }
  // 剩余的堆:先填背包区(10..49),再补物品栏空位
  const order = [...Array(SLOTS_SIZE).keys()].map((k) => (k + HOTBAR_SIZE) % SLOTS_SIZE);
  let cursor = 0;
  for (const s of legacy) {
    if (!s) continue;
    while (cursor < order.length && out[order[cursor]]) cursor++;
    if (cursor >= order.length) break; // 理论到不了:总量同为 50
    out[order[cursor]] = s;
  }
  return out;
}

export class Inventory {
  /** 统一存储:0..9 物品栏,10..49 背包 */
  readonly slots: Slot[] = defaultSlots();
  /** 丢弃栏(1 格,可反悔取回,放入新物品即覆盖旧的) */
  readonly trashSlots: Slot[] = [null];
  /** 拖拽手中堆(仅面板开启期间存在,关面板归还) */
  cursor: Slot = null;
  selectedSlot = 0;
  /** 宝箱内容(坐标键),首次打开按战利品表填充 */
  readonly chestStore = new Map<string, Slot[]>();
  /** 拾取计数(统计),随存档保存 */
  readonly stats = { pickups: 0, counts: {} as Record<number, number> };
  openChestKey: string | null = null;
  /** 创造调色板点选后回调(main 接线关闭面板) */
  onInventoryPick: (() => void) | null = null;
  /** 创造模式豁免所有权(main 注入) */
  isCreative: () => boolean = () => false;
  /** E 面板(背包网格)是否开着 —— 拾取时同步重绘 */
  bagOpen = false;
  private creativeBackup: CreativeBackup | null = null;
  // 旧档字段暂存(load 顺序:hotbar/stash 先于 slots)
  private legacyHotbar: unknown = null;
  private legacyStash: unknown = null;

  constructor(
    private readonly hud: HUD,
    private readonly icons: IconSource,
    private readonly world: World,
    private readonly save: SaveManager,
    private readonly events: EventBus,
  ) {}

  heldId(): number {
    return this.slots[this.selectedSlot]?.id ?? Block.Air;
  }

  /** 现有数(全部 50 格合计) */
  ownedCount(id: number): number {
    return countInSlots(this.slots, id);
  }

  /** 背包还能收纳该物品吗(拾取满包守卫;创造无限,恒可) */
  canFit(id: number): boolean {
    return this.isCreative() || canAddToSlots(this.slots, id);
  }

  /** 放置消耗:从手中这一堆扣一个(泰拉行为),放完槽位即空手;创造不消耗 */
  consumeHeld(): boolean {
    if (this.isCreative()) return true;
    const s = this.slots[this.selectedSlot];
    if (!s) return false;
    s.count--;
    if (s.count <= 0) {
      this.slots[this.selectedSlot] = null;
      this.refreshHotbar(); // 图标清空
    } else {
      this.refreshBadges();
    }
    if (this.bagOpen) this.refreshBag();
    if (this.openChestKey) this.refreshChestUI();
    return true;
  }

  private slotFor(id: number): HotbarSlot {
    return { id, name: itemName(id), icon: itemIcon(this.icons, id) };
  }

  private bagView(s: Slot): BagSlotView {
    return s
      ? { id: s.id, count: s.count, name: itemName(s.id), icon: itemIcon(this.icons, s.id) }
      : null;
  }

  refreshHotbar(): void {
    this.hud.buildHotbar(
      this.slots.slice(0, HOTBAR_SIZE).map((s) => this.slotFor(s?.id ?? Block.Air)),
    );
    this.hud.setSelected(this.selectedSlot);
    this.refreshBadges();
  }

  /** 槽位徽章 = 该格堆叠数(>1 才显示,泰拉式;创造无限不显示) */
  refreshBadges(): void {
    const creative = this.isCreative();
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const n = this.slots[i]?.count ?? 0;
      this.hud.setSlotCount(i, !creative && n > 1 ? n : 0);
    }
  }

  select(i: number): void {
    if (i < 0 || i >= HOTBAR_SIZE) return;
    this.selectedSlot = i;
    this.hud.setSelected(i);
  }

  wheel(dir: number): void {
    this.select((this.selectedSlot + dir + HOTBAR_SIZE) % HOTBAR_SIZE);
  }

  /** 中键选取:物品栏里有 → 切过去;背包里有 → 与当前槽交换;创造凭空给 */
  pickBlock(id: number): void {
    const idx = this.slots.findIndex((s) => s?.id === id);
    if (idx >= 0 && idx < HOTBAR_SIZE) {
      this.select(idx);
      return;
    }
    if (idx >= HOTBAR_SIZE) {
      const tmp = this.slots[this.selectedSlot];
      this.slots[this.selectedSlot] = this.slots[idx];
      this.slots[idx] = tmp;
      this.refreshHotbar();
      if (this.bagOpen) this.refreshBag();
      return;
    }
    if (this.isCreative() && itemDef(id)?.kind === 'block') {
      this.slots[this.selectedSlot] = { id, count: 1 };
      this.refreshHotbar();
      return;
    }
    this.hud.toast(`背包里没有「${itemName(id)}」,先去采集`);
  }

  /** 拾取:并入既有堆(同物品不另占新格),否则进第一个空格(物品栏优先) */
  pickup(id: number): boolean {
    if (this.isCreative()) return true; // 背包冻结:掉落物消散
    if (addToSlots(this.slots, id, 1) > 0) return false; // 满:拒收
    this.stats.pickups++;
    this.stats.counts[id] = (this.stats.counts[id] ?? 0) + 1;
    this.refreshHotbar(); // 可能落进物品栏空格,图标/徽章都要新
    if (this.bagOpen) this.refreshBag();
    if (this.openChestKey) this.refreshChestUI();
    this.events.emit('itemPickedUp', { id, count: 1 });
    return true;
  }

  // ---------- E 面板:生存 = 完整背包网格(拖放),创造 = 全图鉴调色板 ----------

  /** 面板打开(panels onOpen):按模式渲染对应视图 */
  openBag(): void {
    if (this.isCreative()) {
      this.hud.setBagMode('palette');
      this.refreshPalette();
    } else {
      this.bagOpen = true;
      this.hud.setBagMode('bag');
      this.refreshBag();
    }
  }

  /** 面板关闭(panels onClose):手中堆归还(放不下则进丢弃栏兜底,不凭空消失) */
  closeBag(): void {
    this.bagOpen = false;
    if (this.cursor) {
      const left = addToSlots(this.slots, this.cursor.id, this.cursor.count);
      this.cursor = left > 0 ? { id: this.cursor.id, count: left } : null;
      if (this.cursor) {
        this.trashSlots[0] = this.cursor;
        this.cursor = null;
        this.hud.toast('背包已满,手中物品放进了丢弃栏');
      }
      this.hud.setDragGhost(null);
      this.refreshHotbar();
      this.save.markDirty();
    }
  }

  /** 完整背包网格重绘(物品栏行 + 背包 + 丢弃栏 + 手中堆) */
  refreshBag(): void {
    this.hud.buildBag(
      this.slots.slice(0, HOTBAR_SIZE).map((s) => this.bagView(s)),
      this.slots.slice(HOTBAR_SIZE).map((s) => this.bagView(s)),
      this.bagView(this.trashSlots[0]),
      (area, idx, button) => this.onBagCell(area, idx, button),
    );
    this.hud.setDragGhost(this.bagView(this.cursor));
  }

  /** 格子点击:空手 → 拿起(右键拿一半);持堆 → 放下/并入/交换(右键放一个) */
  private onBagCell(area: BagArea, idx: number, button: number): void {
    const slotsOf = (a: BagArea) => (a === 'trash' ? this.trashSlots : this.slots);
    const realIdx = area === 'bag' ? idx + HOTBAR_SIZE : area === 'trash' ? 0 : idx;
    const arr = slotsOf(area);
    if (!this.cursor) {
      const src = arr[realIdx];
      if (!src) return;
      const amount = button === 2 ? Math.ceil(src.count / 2) : undefined;
      this.cursor = liftFromSlot(arr, realIdx, amount);
    } else if (button === 2) {
      // 右键:放一个
      const t = arr[realIdx];
      if (!t) {
        arr[realIdx] = { id: this.cursor.id, count: 1 };
        this.cursor.count--;
      } else if (t.id === this.cursor.id && t.count < 999) {
        t.count++;
        this.cursor.count--;
      }
      if (this.cursor.count <= 0) this.cursor = null;
    } else {
      this.cursor = dropToSlot(arr, realIdx, this.cursor);
    }
    this.refreshBag();
    this.refreshHotbar(); // 物品栏行的改动即时反映到底部快捷栏
    this.save.markDirty();
  }

  /** 创造调色板:点选把物品装进当前手持槽(不占背包) */
  refreshPalette(): void {
    this.hud.buildInventory(
      catalogItems().map((id) => this.slotFor(id)),
      (id) => {
        this.slots[this.selectedSlot] = { id, count: 1 };
        this.refreshHotbar();
        this.hud.toast(`${itemName(id)} → 槽位 ${(this.selectedSlot + 1) % 10}`);
        this.onInventoryPick?.();
      },
    );
  }

  // ---------- 宝箱 ----------

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

  openChest(x: number, y: number, z: number): void {
    this.ensureChestSlots(x, y, z);
    this.openChestKey = `${x},${y},${z}`;
    this.refreshChestUI();
    this.events.emit('chestOpened', { x, y, z });
  }

  closeChest(): void {
    this.openChestKey = null;
  }

  /** 宝箱被摧毁(TNT):取出全部内容物并删除存储 */
  spillChest(x: number, y: number, z: number): { slots: Slot[]; wasOpen: boolean } {
    const key = `${x},${y},${z}`;
    const slots = this.ensureChestSlots(x, y, z);
    this.chestStore.delete(key);
    const wasOpen = this.openChestKey === key;
    if (wasOpen) this.openChestKey = null;
    this.save.markDirty();
    return { slots, wasOpen };
  }

  /** 宝箱双栏:上宝箱下背包(全 50 格),点击整堆转移(并入未满堆,部分转移) */
  refreshChestUI(): void {
    const slots = this.openChestKey ? this.chestStore.get(this.openChestKey) : null;
    if (!slots) return;
    this.hud.buildChest(
      slots.map((s) => this.bagView(s)),
      this.slots.map((s) => this.bagView(s)),
      (side, i) => {
        if (side === 'chest') moveStack(slots, i, this.slots);
        else moveStack(this.slots, i, slots);
        this.refreshChestUI();
        this.refreshHotbar(); // 物品栏格可能被搬空/填入
        this.save.markDirty();
      },
    );
  }

  // ---------- 创造快照 ----------

  /**
   * 创造模式开关:开 → 快照全部库存(槽位/丢弃栏/宝箱),E 面板变全图鉴;
   * 关 → 整体恢复快照,回到进入创造之前的状态。
   */
  setCreativeMode(on: boolean): void {
    if (on) {
      if (!this.creativeBackup) {
        this.creativeBackup = {
          slots: serializeSlots(this.slots),
          trash: this.trashSlots[0]
            ? [0, this.trashSlots[0].id, this.trashSlots[0].count]
            : null,
          chests: Object.fromEntries(
            [...this.chestStore].map(([k, v]) => [k, serializeSlots(v)]),
          ),
        };
      }
    } else if (this.creativeBackup) {
      const b = this.creativeBackup;
      this.creativeBackup = null;
      const restored = b.stash !== undefined || b.hotbar !== undefined
        ? migrateLegacySlots(b.hotbar, b.stash) // 里程碑 55 前的旧快照
        : deserializeSlots(SLOTS_SIZE, b.slots);
      this.slots.splice(0, this.slots.length, ...restored);
      this.trashSlots[0] = b.trash ? { id: b.trash[1], count: b.trash[2] } : null;
      this.chestStore.clear();
      for (const [k, v] of Object.entries(b.chests ?? {})) {
        this.chestStore.set(k, deserializeSlots(CHEST_SIZE, v));
      }
      if (this.openChestKey) this.refreshChestUI();
    }
    this.refreshHotbar();
    this.save.markDirty();
  }

  // ---------- 调试(e2e 契约) ----------

  /** 物品栏 id 视图(空格为 0) */
  hotbarIds(): number[] {
    return this.slots.slice(0, HOTBAR_SIZE).map((s) => s?.id ?? 0);
  }

  /** 调试:装配物品栏布局(每格给一堆 99;0 = 清空该格) */
  setHotbar(ids: number[]): void {
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const id = ids[i] ?? Block.Air;
      this.slots[i] = id === Block.Air ? null : { id, count: 99 };
    }
    this.refreshHotbar();
  }

  /** 调试:把全部物品塞进背包(缺的补 99) */
  giveAll(): void {
    for (const id of inventoryItems()) {
      if (!this.slots.some((s) => s?.id === id)) addToSlots(this.slots, id, 99);
    }
    this.refreshHotbar();
    if (this.bagOpen) this.refreshBag();
  }

  // ---------- 存档 ----------

  /** 注册存档分节:新字段 slots/trash;旧档(hotbar 引用 + stash)自动迁移去重 */
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
    // 旧字段:只读取暂存(迁移在 'slots' 分节里做);hotbar 继续写 id 视图(调试友好)
    this.save.register('hotbar', {
      save: () => this.hotbarIds(),
      load: (d) => {
        this.legacyHotbar = d;
      },
    });
    this.save.register('stash', {
      save: () => undefined, // 不再写出(字段自然消失);读档仅供迁移
      load: (d) => {
        this.legacyStash = d;
      },
    });
    this.save.register('slots', {
      save: () => serializeSlots(this.slots),
      load: (d) => {
        let next: Slot[] | null = null;
        if (Array.isArray(d)) {
          next = deserializeSlots(SLOTS_SIZE, d);
        } else if (this.legacyStash != null || Array.isArray(this.legacyHotbar)) {
          next = migrateLegacySlots(this.legacyHotbar, this.legacyStash);
        }
        if (next) this.slots.splice(0, this.slots.length, ...next);
      },
    });
    this.save.register('trash', {
      save: () =>
        this.trashSlots[0] ? [this.trashSlots[0].id, this.trashSlots[0].count] : null,
      load: (d) => {
        if (Array.isArray(d) && d.length === 2 && typeof d[0] === 'number' && d[0] > 0) {
          this.trashSlots[0] = { id: d[0], count: Math.max(1, Number(d[1]) || 1) };
        }
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
        if (d && typeof d === 'object') {
          const b = d as CreativeBackup;
          if (Array.isArray(b.slots) || Array.isArray(b.stash) || Array.isArray(b.hotbar)) {
            this.creativeBackup = b;
          }
        }
      },
    });
  }
}
