// UI 层 · 模态面板管理器(见 ARCHITECTURE.md §3.8)
// 背包/宝箱/图鉴(未来:对话/商店/合成)统一注册。管理器保证:
// 同刻至多一个模态面板、开合时指针锁的释放/重锁集中处理、Esc/E/点背景语义一致。
// modal=false 的面板(图鉴)只做显隐,不参与指针锁与互斥。

export interface PanelDef {
  el: HTMLElement;
  /** 参与指针锁与互斥(默认 true);图鉴这类暂停界面上的浮层设 false */
  modal?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
}

export class Panels {
  private readonly panels = new Map<string, PanelDef>();
  private openModal: string | null = null;

  constructor(
    /** 进入游戏(桌面请求指针锁 / 触屏软锁) */
    private readonly engage: () => void,
    /** 是否已处于锁定(游戏中) */
    private readonly isLocked: () => boolean,
    /** 不重锁关闭时回到暂停遮罩 */
    private readonly showOverlay: () => void,
    /** 模态开合变化(取消挖掘等) */
    private readonly onModalChange: (open: boolean) => void,
  ) {}

  register(name: string, def: PanelDef): void {
    this.panels.set(name, def);
    // 点暗背景关闭(面板根元素自身被点中才算背景)
    def.el.addEventListener('click', (e) => {
      if (e.target === def.el) this.close(name, true);
    });
  }

  isOpen(name: string): boolean {
    const def = this.panels.get(name);
    return def ? def.el.classList.contains('open') : false;
  }

  get modalOpen(): string | null {
    return this.openModal;
  }

  open(name: string): void {
    const def = this.panels.get(name);
    if (!def || this.isOpen(name)) return;
    const modal = def.modal !== false;
    if (modal) {
      if (this.openModal && this.openModal !== name) this.close(this.openModal, false);
      this.openModal = name;
      this.onModalChange(true);
    }
    def.el.classList.add('open');
    def.onOpen?.();
    // 真实浏览器中释放指针以便点击(测试/触屏的软锁不受影响)
    if (modal && document.pointerLockElement) document.exitPointerLock();
  }

  /** relock=true:回到游戏(重锁);false:回到暂停遮罩(Esc 语义) */
  close(name: string, relock: boolean): void {
    const def = this.panels.get(name);
    if (!def || !this.isOpen(name)) return;
    def.el.classList.remove('open');
    def.onClose?.();
    if (def.modal !== false && this.openModal === name) {
      this.openModal = null;
      this.onModalChange(false);
      if (relock && !this.isLocked()) this.engage();
      else if (!relock) this.showOverlay();
    }
  }

  toggle(name: string): void {
    if (this.isOpen(name)) this.close(name, true);
    else this.open(name);
  }

  /** 指针锁获得时静默关闭全部模态面板(不触发重锁/遮罩逻辑) */
  forceCloseModals(): void {
    for (const [name, def] of this.panels) {
      if (def.modal !== false && this.isOpen(name)) {
        def.el.classList.remove('open');
        def.onClose?.();
        if (this.openModal === name) this.openModal = null;
      }
    }
    this.onModalChange(false);
  }
}
