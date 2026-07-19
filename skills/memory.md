# 工作记忆(每轮必读,保持精炼;过期就删)

## 后端(里程碑 53 起生效,基准文档 BACKEND.md)

- **涉及登录/云存档/server/ 的改动以 `BACKEND.md` 为准**;技术栈:Hono +
  node:sqlite,Node ≥23 原生跑 TS(server 零构建;**禁 enum/namespace/
  构造器参数属性**,import 带 .ts 扩展名)。
- 开发:`npm run server`(8787)+ `npm run dev`(5173,/api 已代理);
  server 不在时游客模式照常(boot 1.5s 超时转本地)。
- 关键不变量:游客键 `mc-demo-save-v1` 格式永不变;游戏内核禁 import
  backend/fetch(网络只在 boot.ts / game/account.ts / ui/account.ts);
  `?test` 默认游客零网络,账号 e2e 用 `?test&account=1`;API 字段只增。
- 同步模型速记:服务端权威,本地是缓冲;`…:meta={rev,pending}`;
  启动对账在 boot.ts(云无档→绑定本地;云更新→云为准+冲突备份);
  游玩期 SaveManager.onSaved → 15s 防抖 PUT(baseRev)→ 409 提示下次启动对账。
- verify 会自动拉起 API server(临时库);新增账号用例在文件尾部。

## 架构(里程碑 52 起生效)

- **新功能必须按 `ARCHITECTURE.md` 的扩展点接入**,不要往 main.ts 加规则代码。
  main.ts 只做组装(现 611 行,保持这个量级)。
- 加内容的入口速查(m57/m58 新增三类):
  - **合成配方/合成站** → `content/recipes.ts` registerRecipe 一条数据(§4.10),
    列表/判定/结算/UI 全自动;**站台 = 被 stations 引用的方块 id**(无需标记),
    新站台按 §4.1 加方块即可;材料物品 → `tools.ts` Mat(130+)+
    `content/items.ts` kind:'material' + paintTool 图标;e2e 用
    `__game.craft.{list,craft,stations}`;别绕过 performCraft 改库存(原子回滚);
  - **装备/饰品** → `content/items.ts` 注册 armor/accessory 字段(§4.7),
    属性经 `game/stats.ts` StatSheet 聚合自动生效;新行为才加字段+消费点;
    获取途径可走战利品表或配方(铁甲三件已是铁砧配方);
  - **世界事件** → `content/events.ts` 注册 WorldEventDef(§4.8),
    修饰推给 mobs.spawnRateMul/ambience.eventFogTint;`?test` 禁自然掷骰,
    e2e 用 `__game.worldEvents.start/stop`;
  - 方块 → `blocks.ts` + `textures.ts`(§4.1);物品/**武器** → `content/items.ts`
    注册 ItemDef/WeaponDef(§4.2,战斗/挖掘自动生效);
  - 点按交互(门/祭坛/恶魔之心)→ `interact.registerBlockUse`;
  - 弹幕(剑气/boss 攻击)→ `game/projectiles.ts` 的 spawn(spec);
  - 世界进度(boss 击败等)→ `game/flags.ts`(自动入档+广播);
  - 存档新字段 → `save.register('分节', {save,load})`,禁改别人的分节;
  - 模态 UI(对话/商店)→ `ui/panels.ts` register;非模态 HUD 件 → `hud.ts`;
  - 跨系统通知 → `core/events.ts`(已有 mobKilled/playerDied/blockBroken 等)。
- **不变量(ARCHITECTURE.md §6,破坏 = 事故)**:方块 id 0..99(现用到 56)/
  物品 100+(工具 100-109、装备 110-119、饰品 120-129、材料 130+)只增不改;
  存档 key `mc-demo-save-v1` 字段只增;`__game` 调试接口只增不改(78 项 e2e 依赖);
  `tests/*.test.ts` 直接 import `../src/<file>`,这些文件的公开导出保持稳定;
  世界生成禁 Math.random;性能预算地表 55+/地狱 45+ FPS。

## 验证流程

- `npm test`(132 单测)→ `npm run build` → 起 `npm run dev`(5173)后
  `npm run verify`(78 项 e2e,需连续两轮全绿)。
- verify 脚本会清 localStorage 重开世界;新玩法要补 e2e 用例 + 截图入 scripts/shots。

## 用户的长期方向(下一步从这里选)

1. **武器系统**:近战扇形挥砍(WeaponDef.swingArc 已留)→ 剑气弹幕(projectile 字段)
   → 武器分级(铁剑/金剑走 §4.10 配方树:锭 @铁砧,战利品表补稀有件)
   → 泰拉之刃 → 天顶剑(orbit 环绕+追踪,需在 projectiles 加追踪模式)。
2. **boss 系统**:按 §4.4 —— 先单体 boss(克苏鲁之眼式)打通
   召唤(血腥地手指末端恶魔之心,交互注册)→ AI+弹幕 → 血条(hud)→ 掉落 →
   flags 记击败;再做多部件(骷髅王式)。
3. **NPC**(§4.5):对话/商店面板 + 入住房屋判定(纯函数可单测)。
4. **大世界交互**:门/祭坛等交互方块(祭坛可作特殊合成站:仅世界生成、
   不入 PLACEABLE);合成后续 = 配方解锁 flag、药水/食物(consumable)。
5. **后端后续**(BACKEND.md §8):多存档位/多角色选择界面(slot 已留位)→
   成就统计上报(事件总线现成)→ 公网部署硬化(HTTPS/备份/CSRF 令牌)。

## 库存语义(里程碑 54/55/56 起)

- **统一实体存储(泰拉模型,m56)**:`inventory.slots` 50 格,0..9 就是
  物品栏、10..49 背包,外加丢弃栏 trashSlots[0];物品栏不是引用 ——
  **同一物品只占一格**(拾取并入既有堆),右键拆堆是唯一合法多堆来源。
  放置消耗手中这一堆(`consumeHeld`),放完即空手;徽章 = 该格堆叠数(>1)。
- E 面板 = 完整网格(空格也渲染)+ 点击拿起/放下拖运(chest.ts 纯函数
  liftFromSlot/dropToSlot)+ 右键拿半/放一;关面板手中堆必须归还
  (closeBag,兜底进丢弃栏,**绝不允许物品凭空消失**)。
- **旧档迁移**:migrateLegacySlots(纯函数,有单测)把引用式 hotbar+stash
  迁到 slots 并对重复引用去重;存档字段 slots/trash 新增,hotbar 保留为
  id 视图,stash 停写;别破坏两代 creativeBackup 的恢复路径。
- e2e 契约:`ui.setHotbar(ids)` 重建每格为 99 堆(调试);`injectSave(json)`
  注入存档并阻断写回;装备物品走 equipItem 助手(verify.mjs)。
- **容量规格(泰拉 PC)**:总 50 格 / 宝箱 40 格 / 单堆 STACK_MAX=999;
  addToSlots 补堆→开新堆→返余量,moveStack 支持部分转移。只增不减
  (读档兼容),别动这些常量的方向。
- 拾取有 `drops.canPickup` 满包守卫;宝箱被炸走 `spillChest` 溢出掉落物。
- **创造模式 = 快照隔离**:开启时 `setCreativeMode(true)` 快照
  stash/快捷栏/宝箱(存档分节 creativeBackup),E 面板 = catalogItems()
  全图鉴,背包冻结(拾取消散);关闭整体恢复。改创造相关逻辑必须保住
  "退出无痕"不变量。
- 改动这三系统时:E 面板槽位的 **title 必须保持纯名称**(e2e 选择器
  `[title="南瓜"]` 依赖),数量走 HotbarSlot.count 由 HUD 渲染 ×N。
- 快捷栏存档校验按物品注册表(itemDef 存在即合法),不要收窄回 PLACEABLE。
- e2e 想要"全新世界"必须点 `#reset-save`(save.reset 阻断写回);
  裸 localStorage.clear()+reload 会被 beforeunload 自动存档写回。

## 踩坑备忘

- 面板开合牵扯指针锁,一律走 `ui/panels.ts`,不要手写 exitPointerLock。
- 玩家开机位置在 warmup 后经"嵌墙自救"校验,所以 'player' 分节是
  peek 一次性消费,load 为空 —— 不要"修复"它。
- 触屏(touch)与桌面共用交互语义,改点按/长按逻辑要过触屏 e2e。
