// 输入:指针锁定、键盘、鼠标视角/按键/滚轮
export class Input {
  private readonly keys = new Set<string>();
  private dx = 0;
  private dy = 0;
  locked = false;

  onLockChange: (locked: boolean) => void = () => {};
  onMouseDown: (button: number) => void = () => {};
  onMouseUp: (button: number) => void = () => {};
  onWheel: (dir: number) => void = () => {};
  onSelectSlot: (index: number) => void = () => {};
  onKey: (code: string) => void = () => {};

  constructor(private readonly canvas: HTMLCanvasElement) {
    document.addEventListener('keydown', (e) => {
      if (this.locked && (e.code === 'Space' || e.code.startsWith('Arrow'))) {
        e.preventDefault();
      }
      const fresh = !this.keys.has(e.code);
      this.keys.add(e.code);
      if (fresh) this.onKey(e.code);
      if (e.code.startsWith('Digit')) {
        const n = Number(e.code.slice(5));
        if (n >= 1 && n <= 9) this.onSelectSlot(n - 1);
        else if (n === 0) this.onSelectSlot(9); // 第 10 格
      }
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.keys.clear();
      this.onLockChange(this.locked);
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 1) e.preventDefault();
      this.onMouseDown(e.button);
    });
    document.addEventListener('mouseup', (e) => {
      if (this.locked) this.onMouseUp(e.button);
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener(
      'wheel',
      (e) => {
        if (this.locked && e.deltaY !== 0) this.onWheel(Math.sign(e.deltaY));
      },
      { passive: true },
    );
  }

  requestLock(onReject?: () => void): void {
    const ret = this.canvas.requestPointerLock() as unknown;
    if (ret && typeof (ret as Promise<void>).catch === 'function') {
      // Chrome 在 Esc 解锁后约 1.25 秒内重新锁定会被拒绝
      (ret as Promise<void>).catch(() => onReject?.());
    }
  }

  /** 软锁定:触屏设备与自动化测试没有真实指针锁定,直接视为已锁定 */
  forceLock(): void {
    this.locked = true;
    this.onLockChange(true);
  }

  /** 软解锁:触屏的暂停按钮用,回到暂停遮罩 */
  forceUnlock(): void {
    this.locked = false;
    this.keys.clear();
    this.onLockChange(false);
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** 读取并清零累计的鼠标位移 */
  consumeLook(): { dx: number; dy: number } {
    const r = { dx: this.dx, dy: this.dy };
    this.dx = 0;
    this.dy = 0;
    return r;
  }
}
