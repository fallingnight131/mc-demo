// 实体层 · 统一实体生命周期(见 ARCHITECTURE.md §3.5)
// 主动实体(点燃的 TNT、弹幕、未来的 boss 部件/召唤物)注册到管理器,
// 由主循环统一驱动:update 返回 false 即消亡,由管理器负责 dispose。
// 生物/掉落物/重力方块暂保留各自既有系统,自然重写时再迁入。

export interface Entity {
  /** 每帧推进;返回 false 表示实体消亡 */
  update(dt: number): boolean;
  /** 摘除场景对象、释放材质 */
  dispose(): void;
  /** 昼夜亮度广播(自发光实体可不实现) */
  setBrightness?(b: number): void;
}

export class EntityManager {
  private readonly list: Entity[] = [];
  private brightness = 1;

  get count(): number {
    return this.list.length;
  }

  add(e: Entity): void {
    e.setBrightness?.(this.brightness);
    this.list.push(e);
  }

  update(dt: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (!this.list[i].update(dt)) {
        this.list[i].dispose();
        this.list.splice(i, 1);
      }
    }
  }

  setBrightness(b: number): void {
    this.brightness = b;
    for (const e of this.list) e.setBrightness?.(b);
  }

  clear(): void {
    for (const e of this.list) e.dispose();
    this.list.length = 0;
  }
}
