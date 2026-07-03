// 触屏操控:虚拟摇杆(移动)+ 全屏拖动层(视角)+ 跳/挖/放/暂停/背包按钮
// 用 Pointer Events 实现:统一鼠标与触摸,自动化测试也能用鼠标事件驱动。

export function isTouchDevice(): boolean {
  return 'ontouchstart' in window || matchMedia('(pointer: coarse)').matches;
}

/** 摇杆位移 → 移动向量(带死区、半径截断;纯函数便于单测) */
export function stickVector(dx: number, dy: number, radius: number): { x: number; y: number } {
  const len = Math.hypot(dx, dy);
  if (len < radius * 0.16) return { x: 0, y: 0 }; // 死区
  const s = Math.min(1, len / radius) / len;
  return { x: dx * s, y: dy * s };
}

const LOOK_SCALE = 2.4; // 触摸像素 → 视角增量的放大(乘在鼠标灵敏度之上)

export class TouchControls {
  readonly root: HTMLElement;
  /** 摇杆移动向量:x 右 / y 前,-1..1 */
  readonly moveVec = { x: 0, y: 0 };
  jumpHeld = false;
  mineHeld = false;
  placeHeld = false;
  onPause: () => void = () => {};
  onInventory: () => void = () => {};

  private lookDx = 0;
  private lookDy = 0;
  private lookPointer = -1;
  private lookLastX = 0;
  private lookLastY = 0;
  private joyPointer = -1;
  private readonly knob: HTMLElement;
  private readonly base: HTMLElement;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'touch-ui';

    const el = (id: string, cls: string, text = '', parent: HTMLElement = this.root) => {
      const d = document.createElement('div');
      d.id = id;
      if (cls) d.className = cls;
      d.textContent = text;
      parent.appendChild(d);
      return d;
    };

    // 视角层先加(在下),按钮后加(在上)
    const look = el('touch-look', '');
    this.base = el('joy-base', '');
    this.knob = el('joy-knob', '', '', this.base);
    const jump = el('btn-jump', 'touch-btn', '跳');
    const mine = el('btn-mine', 'touch-btn', '挖');
    const place = el('btn-place', 'touch-btn', '放');
    const pause = el('btn-pause', 'touch-btn', 'Ⅱ');
    const inv = el('btn-inv', 'touch-btn', '包');

    // --- 摇杆 ---
    const applyJoy = (e: PointerEvent) => {
      const r = this.base.getBoundingClientRect();
      const radius = r.width / 2;
      const dx = e.clientX - (r.left + radius);
      const dy = e.clientY - (r.top + radius);
      const v = stickVector(dx, dy, radius);
      this.moveVec.x = v.x;
      this.moveVec.y = -v.y; // 屏幕向上 = 前进
      const len = Math.min(Math.hypot(dx, dy), radius);
      const a = Math.atan2(dy, dx);
      this.knob.style.transform = `translate(${Math.cos(a) * len}px, ${Math.sin(a) * len}px)`;
    };
    this.base.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.joyPointer = e.pointerId;
      this.base.setPointerCapture(e.pointerId);
      applyJoy(e);
    });
    this.base.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.joyPointer) applyJoy(e);
    });
    const joyEnd = (e: PointerEvent) => {
      if (e.pointerId !== this.joyPointer) return;
      this.joyPointer = -1;
      this.moveVec.x = 0;
      this.moveVec.y = 0;
      this.knob.style.transform = '';
    };
    this.base.addEventListener('pointerup', joyEnd);
    this.base.addEventListener('pointercancel', joyEnd);

    // --- 视角拖动层 ---
    look.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.lookPointer = e.pointerId;
      look.setPointerCapture(e.pointerId);
      this.lookLastX = e.clientX;
      this.lookLastY = e.clientY;
    });
    look.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookPointer) return;
      this.lookDx += (e.clientX - this.lookLastX) * LOOK_SCALE;
      this.lookDy += (e.clientY - this.lookLastY) * LOOK_SCALE;
      this.lookLastX = e.clientX;
      this.lookLastY = e.clientY;
    });
    const lookEnd = (e: PointerEvent) => {
      if (e.pointerId === this.lookPointer) this.lookPointer = -1;
    };
    look.addEventListener('pointerup', lookEnd);
    look.addEventListener('pointercancel', lookEnd);

    // --- 按住类按钮 ---
    const hold = (btn: HTMLElement, set: (v: boolean) => void) => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.setPointerCapture(e.pointerId);
        btn.classList.add('active');
        set(true);
      });
      const end = () => {
        btn.classList.remove('active');
        set(false);
      };
      btn.addEventListener('pointerup', end);
      btn.addEventListener('pointercancel', end);
    };
    hold(jump, (v) => (this.jumpHeld = v));
    hold(mine, (v) => (this.mineHeld = v));
    hold(place, (v) => (this.placeHeld = v));

    // --- 点按类按钮 ---
    const tap = (btn: HTMLElement, fn: () => void) => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
      });
    };
    tap(pause, () => this.onPause());
    tap(inv, () => this.onInventory());
  }

  /** 读取并清零累计的视角位移(与鼠标 consumeLook 同语义) */
  consumeLook(): { dx: number; dy: number } {
    const r = { dx: this.lookDx, dy: this.lookDy };
    this.lookDx = 0;
    this.lookDy = 0;
    return r;
  }
}
