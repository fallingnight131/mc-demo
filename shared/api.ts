// 前后端共享的 API 契约类型(BACKEND.md §5)。字段只增不改;错误码是契约。
// 该文件不 import 任何东西 —— 前端(bundler 解析)与 server(node 原生 TS)都直接引用。

export type ApiError =
  | 'invalid' // 请求体不合法(用户名/口令格式等)
  | 'taken' // 用户名已被占用
  | 'bad_credentials' // 用户名或口令错误
  | 'unauthorized' // 未登录 / 会话失效
  | 'no_save' // 云端尚无存档
  | 'conflict' // 存档版本冲突(乐观并发)
  | 'too_large' // 存档载荷超限
  | 'rate_limited' // 触发限流
  | 'not_found';

export interface ErrorBody {
  error: ApiError;
}

export interface UserInfo {
  id: number;
  username: string;
}

export interface AuthBody {
  username: string;
  password: string;
}

/** GET /api/saves/:slot 响应 */
export interface SaveInfo {
  rev: number;
  updatedAt: number;
  /** SaveManager 分节 JSON(服务端不解释,见 BACKEND.md §7.3) */
  payload: unknown;
}

/** PUT /api/saves/:slot 请求 */
export interface SavePut {
  /** 客户端所基于的云版本(首次上传为 0);不匹配则 409 + 当前 rev */
  baseRev: number;
  payload: unknown;
}

export interface SavePutOk {
  rev: number;
}

/** 409 冲突响应:附当前云版本号,客户端应重新拉取对账 */
export interface SaveConflict extends ErrorBody {
  error: 'conflict';
  rev: number;
}

/** 存档载荷上限(字符数,≈2 MiB) */
export const SAVE_PAYLOAD_LIMIT = 2 * 1024 * 1024;

/** 用户名规则:3~24 位字母/数字/下划线/汉字 */
export const USERNAME_RE = /^[\w一-鿿]{3,24}$/u;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;
