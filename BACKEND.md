# Terraria 3D — 后端架构蓝图

> 与 `ARCHITECTURE.md`(前端/游戏架构)配套。后端的一切改动以本文为基准:
> 不适配时先改文档、再改代码。§7 不变量与前端蓝图 §6 同级,破坏 = 事故。

## 1. 目标与非目标

**目标(按用户规划)**

- 玩家可**注册账号**或以**游客模式**游玩。
- 账号玩家的游戏进度存在服务端,**每个账号独立进度**,换设备/清浏览器不丢档。
- 游客升级为账号时,**当前本地进度可带入账号**(绑定)。
- 为长期演进留位:多存档位(泰拉瑞亚式多角色/多世界)、成就与统计、
  (若未来推翻"无多人"非目标)实时服务另立进程。

**非目标(当前)**

- 不做实时多人(CLAUDE.md 非目标;本协议是"存档同步",不是状态同步)。
- 不做邮箱验证/找回密码/OAuth(演示规模;§8 路线图 B 预留)。
- 不做服务端反作弊:存档载荷对服务端是**不透明 JSON**,服务端只管归属、
  版本与大小,不校验游戏语义(单人游戏,作弊只坑自己)。

## 2. 技术选型(与理由)

| 项 | 选择 | 理由 |
|---|---|---|
| 语言 | **TypeScript(全栈同构)** | 与前端同语言;`shared/` 可共享 API 类型;自主开发循环只需一套心智 |
| 运行时 | **Node ≥ 23**(原生跑 TS) | 本机 v23.11;`node src/index.ts` 直接执行,**服务端零构建步骤**(注意:不用 enum/namespace,import 带 `.ts` 扩展名) |
| Web 框架 | **Hono**(+ `@hono/node-server`) | 极轻、TS 优先、`app.request()` 内建测试通道;仅有的两个运行时依赖 |
| 数据库 | **`node:sqlite`**(内置) | 零外部服务、零 npm 依赖;单文件 WAL,演示规模(<万级用户)绰绰有余;测试用 `:memory:` |
| 口令哈希 | **`node:crypto` scrypt** | 内置、抗 GPU;无需引 argon2 原生模块 |
| 会话 | **服务端不透明令牌 + HttpOnly Cookie** | 可撤销(登出/过期即删行);比 localStorage JWT 安全(免 XSS 窃取);SQLite 存会话表成本为零 |
| 测试 | **vitest**(server/ 独立包) | 与前端一致;经 `app.request()` 无需起端口 |

**何时升级**(写进路线图,不是现在):并发写变多或要多实例 → SQLite 换
Postgres(SQL 已按标准写,迁移面窄);限流/会话要跨实例 → 加 Redis;
用户量大 → 口令哈希换 argon2id。选型原则与前端一致:**第二个使用者出现才抽象**。

## 3. 拓扑与目录

```
开发:  Vite(5173,前端) ── /api 代理 ──► Hono(8787)── SQLite(server/data/game.db)
生产:  单进程 Hono(8787):serve dist/ 静态文件 + /api          (同源,无 CORS)
测试:  vitest → app.request()(不监听端口)+ :memory: 数据库
```

```
server/                     # 独立包(自己的 package.json,不进前端依赖树)
  src/
    index.ts                # 入口:监听 + 生产态静态托管
    app.ts                  # 组装 Hono 路由(可测的纯工厂 createApp(db))
    db.ts                   # 打开 SQLite + PRAGMA + user_version 增量迁移
    auth.ts                 # scrypt 哈希/校验、会话签发/验证/撤销
    ratelimit.ts            # 内存令牌桶(单实例;换 Redis 见 §8)
    routes/auth.ts          # /api/auth/*
    routes/saves.ts         # /api/saves/*
  test/                     # vitest:认证/会话/存档并发/限流/上限
  data/                     # 运行时数据(gitignore)
shared/
  api.ts                    # 前后端共享的 API 类型(请求/响应/错误码)
```

前端新增(遵循 ARCHITECTURE.md 分层):`src/core/backend.ts`(API 客户端,核心层)、
`src/game/account.ts`(账号状态与云同步,系统层)、`src/ui/account.ts`(账号页签)、
`src/boot.ts`(异步引导入口)。

## 4. 数据模型(SQLite,`PRAGMA user_version` 增量迁移)

```sql
users    (id INTEGER PK, username TEXT UNIQUE COLLATE NOCASE, pass TEXT,  -- scrypt$N$r$p$salt$hash
          created_at INTEGER)
sessions (token_hash TEXT PK,          -- sha256(令牌);库泄露不泄露会话
          user_id INTEGER → users, expires_at INTEGER, created_at INTEGER)
saves    (user_id INTEGER → users, slot INTEGER DEFAULT 0,  -- 多存档位留位:PK(user_id, slot)
          rev INTEGER,                 -- 单调递增,乐观并发的世界版本
          payload TEXT,                -- SaveManager 分节 JSON,服务端不解释
          updated_at INTEGER,
          PRIMARY KEY (user_id, slot))
```

- 用户名:3~24 位 `[A-Za-z0-9_一-鿿]`,大小写不敏感唯一;口令 ≥ 8 位。
- `payload` 上限 **2 MiB**(现存档为 KB 级;超限返回 413,提示玩家清理)。

## 5. API 契约 v1(同源 `/api/*`;演进原则:字段只增,破坏性变更走 `/api/v2`)

| 方法 | 路径 | 请求 | 成功 | 失败 |
|---|---|---|---|---|
| POST | `/api/auth/register` | `{username, password}` | `201 {user}` + Set-Cookie | `409 taken` `400 invalid` `429` |
| POST | `/api/auth/login` | `{username, password}` | `200 {user}` + Set-Cookie | `401 bad_credentials` `429` |
| POST | `/api/auth/logout` | — | `204`(撤销会话+清 Cookie) | — |
| GET | `/api/auth/me` | Cookie | `200 {user}` | `401` |
| GET | `/api/saves/0` | Cookie | `200 {rev, updatedAt, payload}` | `401` `404 no_save` |
| PUT | `/api/saves/0` | `{baseRev, payload}` | `200 {rev}`(=baseRev+1) | `401` `409 {rev}`(并发冲突) `413` `429` |
| GET | `/api/health` | — | `200 {ok}` | — |

错误体统一 `{error: string}`(机器码,`shared/api.ts` 枚举);Cookie:`sid`,
HttpOnly + SameSite=Lax + Path=/(生产加 Secure),30 天滑动过期。
CSRF:SameSite=Lax + 仅接受 `application/json` 已够演示级;硬化(双提交令牌)入 §8。
限流(内存桶/每 IP):auth 20 次/10 分钟,saves 60 次/分钟。

## 6. 存档同步协议(核心设计)

**原则:服务端是账号进度的**权威副本**;localStorage 是各端的**本地缓冲**
(离线容错 + 快速启动),游客则只有本地。**

- **存储键隔离**:游客沿用 `mc-demo-save-v1`(格式与历史完全一致,零回归);
  账号玩家用 `mc-demo-save-v1:u<id>`,旁挂 `…:meta = {rev, pending}` ——
  `rev` 为该缓冲派生自的云版本,`pending` 表示有未推送的本地改动。
- **启动对账**(boot.ts,进世界之前):
  1. `GET /me`(1.5s 超时;失败/游客 → 本地模式)。
  2. 登录态:`GET /saves/0`,与本地 meta 比较:
     - 云无档:本地有 → 推送绑定(游客升级路径);都无 → 新世界。
     - `云 rev == meta.rev`:`pending` → 推送本地(快进);否则用云(等价)。
     - `云 rev > meta.rev`:`pending=false` → 拉云覆盖本地;
       `pending=true` → **冲突**:以云为准,本地备份到 `…:conflict`,进游戏后 toast 告知。
  3. 胜者写入 localStorage 用户键 → 之后 `main.ts` 照常同步读档(**游戏内核不感知网络**)。
- **游玩期推送**:`SaveManager.saveNow()` 落盘后经 `onSaved(json)` 钩子把载荷交给
  账号系统 → 标记 `pending` → **防抖 15s** `PUT {baseRev: meta.rev}`:
  `200 {rev}` → meta={rev, pending:false};`409 {rev}` → 拉云、按启动对账规则处理并提示。
  页面隐藏/关闭时用 `fetch(..., {keepalive:true})` 立即冲刷。
- **登出**:冲刷 → 撤销会话 → 刷新页面回游客键。登录/注册成功同样**刷新页面**
  切键重启世界 —— 换身份 = 换世界,整页重启比热切换简单且无状态残留。

## 7. 不变量(破坏 = 事故)

1. **游客模式 = 后端出现前的行为**:不登录/服务器不在,游戏功能与 61 项 e2e 全部照旧;
   `mc-demo-save-v1` 键与格式永不改变。
2. **游戏内核不感知网络**:`src/game/**`、`World`、主循环禁止 import backend/fetch;
   网络只存在于 boot 引导与账号系统(`core/backend.ts` / `game/account.ts` / `ui/account.ts`)。
3. **载荷同构**:云端 `payload` 就是 SaveManager 分节 JSON(前端蓝图 §3.3),
   字段只增;服务端永不解析其内部结构。
4. **API 演进**:v1 路径与字段只增不改;错误码是契约(`shared/api.ts`)。
5. **`?test` 默认游客且零网络**(既有 e2e 确定性);账号链路 e2e 显式用 `?test&account=1`。
6. **口令与会话**:明文口令不落日志;库中只存 scrypt 哈希与会话令牌的 sha256。

## 8. 路线图

- **A(本轮)**:账号 + 会话 + 云存档同步 + 账号页签 + 游客绑定;server 单测 + 账号 e2e。
- **B**:多存档位(slot 已在 PK 里)= 泰拉瑞亚式多角色/多世界选择界面;找回口令(邮箱)。
- **C**:成就/统计上报(前端事件总线 `mobKilled`/`playerDied` 已是现成素材)、
  轻量排行(最深下潜/boss 击杀时间)。
- **D(若推翻"无多人"非目标)**:实时服务**另立进程**(WebSocket,权威状态另设计),
  账号/会话复用本服务;本存档协议不动。
- 规模化触发器:多实例 → Postgres + Redis;公网部署 → HTTPS/Secure Cookie、
  反代限流、备份策略(SQLite 文件快照即备份)。
