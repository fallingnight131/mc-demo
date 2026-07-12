// 系统层 · 装备(ARCHITECTURE.md §3.8b):8 个装备槽(头/身/腿 + 5 饰品),
// 放入/取下即重新聚合 StatSheet;槽型校验;随存档保存(分节 'equip')。
// 槽位与背包共用 Slot 形态,拖放走背包面板同一套 lift/drop。
import { deserializeSlots, serializeSlots, type Slot } from '../chest';
import { itemDef } from '../content/items';
import type { SaveManager } from '../core/save';
import { BASE_STATS, computeStats, type StatSheet } from './stats';

/** 槽位布局:0 头 / 1 身 / 2 腿 / 3..7 饰品 */
export const ARMOR_SLOT_COUNT = 3;
export const ACCESSORY_SLOT_COUNT = 5;
export const EQUIP_SLOT_COUNT = ARMOR_SLOT_COUNT + ACCESSORY_SLOT_COUNT;
export const EQUIP_SLOT_NAMES = ['头盔', '护胸', '护腿', '饰品', '饰品', '饰品', '饰品', '饰品'];

/** 该物品能进第 idx 号装备槽吗(纯函数,可单测) */
export function canEquipAt(idx: number, id: number): boolean {
  const def = itemDef(id);
  if (!def) return false;
  if (idx < ARMOR_SLOT_COUNT) {
    const want = (['head', 'body', 'legs'] as const)[idx];
    return def.kind === 'armor' && def.armor?.slot === want;
  }
  return def.kind === 'accessory';
}

export class Equipment {
  readonly slots: Slot[] = Array.from({ length: EQUIP_SLOT_COUNT }, () => null);
  /** 聚合后的属性表(Player/combat/interact 只读这里) */
  stats: StatSheet = { ...BASE_STATS };
  /** 装备变化(maxHp 变了要重画心条等) */
  onChanged: (() => void) | null = null;

  constructor(private readonly save: SaveManager) {}

  recompute(): void {
    const sources = [];
    for (const s of this.slots) {
      if (!s) continue;
      const def = itemDef(s.id);
      if (def?.armor) sources.push({ defense: def.armor.defense });
      if (def?.accessory?.stats) sources.push(def.accessory.stats);
    }
    this.stats = computeStats(sources);
    this.onChanged?.();
  }

  registerSave(): void {
    this.save.register('equip', {
      save: () => serializeSlots(this.slots),
      load: (d) => {
        if (!Array.isArray(d)) return;
        const loaded = deserializeSlots(EQUIP_SLOT_COUNT, d);
        // 槽型校验(容忍坏档/改版):不匹配的直接丢回空
        for (let i = 0; i < EQUIP_SLOT_COUNT; i++) {
          const s = loaded[i];
          this.slots[i] = s && canEquipAt(i, s.id) ? s : null;
        }
        this.recompute();
      },
    });
  }
}
