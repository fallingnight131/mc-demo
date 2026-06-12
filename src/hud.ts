// HUD:物品栏、调试信息、开始/暂停遮罩
export interface HotbarSlot {
  id: number;
  name: string;
  icon: HTMLCanvasElement;
}

export class HUD {
  private readonly overlay = document.getElementById('overlay')!;
  private readonly overlayTitle = document.getElementById('overlay-title')!;
  private readonly hotbar = document.getElementById('hotbar')!;
  private readonly debug = document.getElementById('debug')!;
  private readonly itemName = document.getElementById('item-name')!;
  private slotEls: HTMLElement[] = [];
  private slots: HotbarSlot[] = [];
  private nameTimer: ReturnType<typeof setTimeout> | null = null;

  buildHotbar(slots: HotbarSlot[]): void {
    this.slots = slots;
    this.hotbar.innerHTML = '';
    this.slotEls = slots.map((slot, i) => {
      const el = document.createElement('div');
      el.className = 'slot';
      slot.icon.classList.add('slot-icon');
      el.appendChild(slot.icon);
      const key = document.createElement('span');
      key.className = 'slot-key';
      key.textContent = String(i + 1);
      el.appendChild(key);
      this.hotbar.appendChild(el);
      return el;
    });
  }

  setSelected(index: number): void {
    this.slotEls.forEach((el, i) => el.classList.toggle('selected', i === index));
    const slot = this.slots[index];
    if (slot) {
      this.itemName.textContent = slot.name;
      this.itemName.classList.add('visible');
      if (this.nameTimer) clearTimeout(this.nameTimer);
      this.nameTimer = setTimeout(() => this.itemName.classList.remove('visible'), 1500);
    }
  }

  setOverlayVisible(visible: boolean, paused: boolean): void {
    this.overlay.classList.toggle('hidden', !visible);
    this.overlayTitle.textContent = paused ? '已暂停' : 'MC Demo';
  }

  setDebug(text: string): void {
    this.debug.textContent = text;
  }
}
