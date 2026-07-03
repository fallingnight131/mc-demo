// HUD:物品栏、背包、调试信息、开始/暂停遮罩
export interface HotbarSlot {
  id: number;
  name: string;
  icon: HTMLCanvasElement;
}

/** 图标画布可能同时出现在快捷栏与背包的多个槽位,DOM 中必须用副本 */
function copyIcon(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  c.getContext('2d')!.drawImage(src, 0, 0);
  c.classList.add('slot-icon');
  return c;
}

export class HUD {
  private readonly overlay = document.getElementById('overlay')!;
  private readonly overlayTitle = document.getElementById('overlay-title')!;
  private readonly overlayHint = document.getElementById('overlay-hint')!;
  private readonly hotbar = document.getElementById('hotbar')!;
  private readonly inventory = document.getElementById('inventory')!;
  private readonly invGrid = document.getElementById('inv-grid')!;
  private readonly debug = document.getElementById('debug')!;
  private readonly itemName = document.getElementById('item-name')!;
  private readonly hand = document.getElementById('hand') as HTMLImageElement;
  private slotEls: HTMLElement[] = [];
  private slots: HotbarSlot[] = [];
  private nameTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly handIcons = new Map<number, string>();

  buildHotbar(slots: HotbarSlot[]): void {
    this.slots = slots;
    this.hotbar.innerHTML = '';
    this.slotEls = slots.map((slot, i) => {
      const el = document.createElement('div');
      el.className = 'slot';
      el.appendChild(copyIcon(slot.icon));
      const key = document.createElement('span');
      key.className = 'slot-key';
      key.textContent = String((i + 1) % 10);
      el.appendChild(key);
      const count = document.createElement('span');
      count.className = 'slot-count';
      el.appendChild(count);
      this.hotbar.appendChild(el);
      return el;
    });
  }

  /** 背包网格:点击一格调用 onPick(方块 id) */
  buildInventory(items: HotbarSlot[], onPick: (id: number) => void): void {
    this.invGrid.innerHTML = '';
    for (const it of items) {
      const el = document.createElement('div');
      el.className = 'slot inv-slot';
      el.title = it.name;
      el.appendChild(copyIcon(it.icon));
      const name = document.createElement('span');
      name.className = 'inv-name';
      name.textContent = it.name;
      el.appendChild(name);
      el.addEventListener('click', () => onPick(it.id));
      this.invGrid.appendChild(el);
    }
  }

  setInventoryVisible(v: boolean): void {
    this.inventory.classList.toggle('open', v);
  }

  /** 槽位右下角的拾取计数(0 则隐藏) */
  setSlotCount(index: number, n: number): void {
    const el = this.slotEls[index]?.querySelector('.slot-count');
    if (el) el.textContent = n > 0 ? String(Math.min(n, 999)) : '';
  }

  setSelected(index: number): void {
    this.slotEls.forEach((el, i) => el.classList.toggle('selected', i === index));
    const slot = this.slots[index];
    if (slot) {
      this.itemName.textContent = slot.name;
      this.itemName.classList.add('visible');
      if (this.nameTimer) clearTimeout(this.nameTimer);
      this.nameTimer = setTimeout(() => this.itemName.classList.remove('visible'), 1500);
      // 手持方块跟随选中槽位
      let url = this.handIcons.get(slot.id);
      if (!url) {
        url = slot.icon.toDataURL();
        this.handIcons.set(slot.id, url);
      }
      this.hand.src = url;
    }
  }

  /** 手持方块挥动一下(挖掘/放置反馈) */
  punchHand(): void {
    this.hand.classList.remove('punch');
    void this.hand.offsetWidth; // 强制 reflow 以重启动画
    this.hand.classList.add('punch');
  }

  /** 手持方块随昼夜变暗(值为 CSS brightness,变化超过阈值才写样式) */
  private handBrightness = -1;
  setHandBrightness(b: number): void {
    if (Math.abs(b - this.handBrightness) < 0.01) return;
    this.handBrightness = b;
    this.hand.style.filter = `drop-shadow(0 6px 10px rgba(0, 0, 0, 0.35)) brightness(${b.toFixed(2)})`;
  }

  /** 短暂的文字提示(复用物品名气泡,如拾取 +1) */
  toast(text: string): void {
    this.itemName.textContent = text;
    this.itemName.classList.add('visible');
    if (this.nameTimer) clearTimeout(this.nameTimer);
    this.nameTimer = setTimeout(() => this.itemName.classList.remove('visible'), 1200);
  }

  setOverlayVisible(visible: boolean, paused: boolean): void {
    this.overlay.classList.toggle('hidden', !visible);
    this.overlayTitle.textContent = paused ? '已暂停' : 'MC Demo';
  }

  setOverlayHint(text: string): void {
    this.overlayHint.textContent = text;
  }

  setDebug(text: string): void {
    this.debug.textContent = text;
  }
}
