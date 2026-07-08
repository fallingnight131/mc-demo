// HUD:物品栏、背包、图鉴、调试信息、开始/暂停遮罩
export interface HotbarSlot {
  id: number;
  name: string;
  icon: HTMLCanvasElement;
}

/** 图鉴条目:图标 + 名称 + 说明 */
export interface CodexEntry {
  icon: HTMLCanvasElement;
  name: string;
  desc: string;
}
/** 图鉴分类(方块/家具/工具武器/植被/生物) */
export interface CodexCategory {
  title: string;
  entries: CodexEntry[];
}

/** 宝箱/背包槽位视图:图标 + 名称 + 堆叠数 */
export interface ChestSlotView {
  id: number;
  name: string;
  count: number;
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
  /** 触屏点击槽位选中 */
  onSlotTap: ((i: number) => void) | null = null;
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
      el.addEventListener('click', () => this.onSlotTap?.(i));
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

  /** 图鉴:分类渲染图标 + 名称 + 说明 */
  buildCodex(categories: CodexCategory[]): void {
    const body = document.getElementById('codex-body')!;
    body.innerHTML = '';
    for (const cat of categories) {
      const head = document.createElement('div');
      head.className = 'codex-cat';
      head.textContent = `${cat.title}(${cat.entries.length})`;
      body.appendChild(head);
      const grid = document.createElement('div');
      grid.className = 'codex-grid';
      for (const e of cat.entries) {
        const el = document.createElement('div');
        el.className = 'codex-entry';
        el.appendChild(copyIcon(e.icon));
        const text = document.createElement('div');
        const name = document.createElement('div');
        name.className = 'cx-name';
        name.textContent = e.name;
        const desc = document.createElement('div');
        desc.className = 'cx-desc';
        desc.textContent = e.desc;
        text.appendChild(name);
        text.appendChild(desc);
        el.appendChild(text);
        grid.appendChild(el);
      }
      body.appendChild(grid);
    }
  }

  setCodexVisible(v: boolean): void {
    document.getElementById('codex')!.classList.toggle('open', v);
  }

  /** 宝箱双栏(泰拉式):上宝箱、下背包,点某格把整堆移到另一侧 */
  buildChest(
    chestSlots: (ChestSlotView | null)[],
    stashSlots: (ChestSlotView | null)[],
    onTransfer: (side: 'chest' | 'stash', index: number) => void,
  ): void {
    const body = document.getElementById('chest-body')!;
    body.innerHTML = '';
    const grid = (title: string, slots: (ChestSlotView | null)[], side: 'chest' | 'stash') => {
      const label = document.createElement('div');
      label.className = 'chest-label';
      label.textContent = title;
      body.appendChild(label);
      const g = document.createElement('div');
      g.className = 'chest-grid chest-grid-' + side;
      slots.forEach((s, i) => {
        const el = document.createElement('div');
        el.className = 'chest-slot';
        if (s) {
          el.appendChild(copyIcon(s.icon));
          if (s.count > 1) {
            const c = document.createElement('span');
            c.className = 'chest-count';
            c.textContent = String(s.count);
            el.appendChild(c);
          }
          el.title = s.name;
          el.addEventListener('click', () => onTransfer(side, i));
        }
        g.appendChild(el);
      });
      body.appendChild(g);
    };
    grid('宝箱', chestSlots, 'chest');
    grid('背包', stashSlots, 'stash');
  }

  setChestVisible(v: boolean): void {
    document.getElementById('chest')!.classList.toggle('open', v);
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

  /** 第三人称时隐藏第一人称手持图标 */
  setHandVisible(v: boolean): void {
    this.hand.style.display = v ? '' : 'none';
  }

  /** 生命值心条:hp 0..10,每颗心 2 点(满/半/空) */
  setHearts(hp: number): void {
    const el = document.getElementById('hearts')!;
    let html = '';
    for (let i = 0; i < 5; i++) {
      const v = hp - i * 2;
      const cls = v >= 2 ? 'full' : v >= 1 ? 'half' : 'empty';
      html += `<span class="heart ${cls}">\u2764</span>`;
    }
    el.innerHTML = html;
  }

  /** 深度计:层名 + 深度(变化时才写 DOM) */
  private layerText = '';
  setLayer(name: string, depth: number): void {
    const text = depth > 2 ? `${name} · 深度 ${depth}` : name;
    if (text === this.layerText) return;
    this.layerText = text;
    const el = document.getElementById('depth-meter')!;
    el.textContent = text;
    el.classList.toggle('deep', name !== '地表' && name !== '天空层');
  }

  /** 受击红闪 */
  flashDamage(): void {
    const el = document.getElementById('damage-tint')!;
    el.classList.remove('show');
    void el.offsetWidth; // 重启动画
    el.classList.add('show');
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
