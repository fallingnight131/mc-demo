// 核心层 · 存档分节管理器(见 ARCHITECTURE.md §3.3)
// 各系统注册自己的分节 {key, save, load};落盘仍是单条 localStorage 记录,
// 顶层字段名 = 分节 key,与历史存档(mc-demo-save-v1 的扁平字段)完全兼容。
//
// 启动顺序约定:new SaveManager(key).read() → 按依赖顺序 register(注册即读取
// 本分节旧数据,注册顺序 = 加载顺序,world 的 edits 必须先于玩家位置)。
// 分节 load 必须容忍 undefined / 坏数据(旧档升级、隐私模式)。

export interface SaveSection {
  save(): unknown;
  load(data: unknown): void;
}

/** 可注入的存储后端(测试用内存实现;默认 localStorage) */
export interface KVStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class SaveManager {
  private readonly sections: Array<[string, SaveSection]> = [];
  private data: Record<string, unknown> | null = null;
  /** 清档重开中:阻断一切写回(含 visibilitychange/beforeunload 的自动存档) */
  private blocked = false;
  /** 非世界编辑的改动(宝箱存取/旗标等)请求下一次周期存档 */
  dirty = false;

  constructor(
    private readonly key: string,
    private readonly storage: KVStorage | null = typeof localStorage === 'undefined'
      ? null
      : localStorage,
  ) {}

  /** 启动时读档;返回是否存在有效存档 */
  read(): boolean {
    this.data = null;
    try {
      const raw = this.storage?.getItem(this.key);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          this.data = parsed as Record<string, unknown>;
        }
      }
    } catch {
      this.data = null; // 坏档按无档处理
    }
    return this.data !== null;
  }

  get hasSave(): boolean {
    return this.data !== null;
  }

  /** 只读窥视某分节的原始数据(注册前需要预判时用,一般不要用) */
  peek(key: string): unknown {
    return this.data?.[key];
  }

  /** 注册分节并立即加载它的旧数据(可能为 undefined) */
  register(key: string, section: SaveSection): void {
    this.sections.push([key, section]);
    if (this.data) section.load(this.data[key]);
  }

  markDirty(): void {
    this.dirty = true;
  }

  /** 收集全部分节并落盘(清档中 / 存储不可用时静默跳过) */
  saveNow(): void {
    if (this.blocked || !this.storage) return;
    try {
      const out: Record<string, unknown> = {};
      for (const [key, s] of this.sections) out[key] = s.save();
      this.storage.setItem(this.key, JSON.stringify(out));
      this.dirty = false;
    } catch {
      // 隐私模式等存储不可用:静默跳过
    }
  }

  /** 清档重开:删除存档并阻断后续一切写回 */
  reset(): void {
    this.blocked = true;
    try {
      this.storage?.removeItem(this.key);
    } catch {
      // 忽略
    }
  }
}
