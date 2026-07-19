# Terraria 3D — 架构蓝图

> 本文档是项目的**长期架构基准**。所有新功能(武器、boss、NPC、大世界交互等)必须按本文的
> 分层与扩展点接入;发现架构不适配时,先改本文档、再改代码。
> 配套阅读:`CLAUDE.md`(愿景与工作方式)、`skills/progress.md`(逐里程碑进度)、
> **`BACKEND.md`(账号/云存档后端蓝图 —— 涉及登录、存档同步、server/ 的改动以它为准)**。

---

## 1. 设计目标与原则

未来要支撑的功能(按用户规划):

- **复杂武器系统**:近战挥砍、弹幕武器、泰拉之刃(挥砍+剑气弹幕)、天顶剑(多剑环绕追踪)、
  远程/魔法武器、合成树与武器分级。
- **复杂 boss 系统**:多部件 boss(如骷髅王的头+双手)、阶段切换、弹幕攻击、召唤物、
  boss 血条、召唤仪式(恶魔之心/祭坛)、击败后推进世界进度。
- **大世界交互**:门、祭坛、恶魔之心、机关、可触发的世界事件(血月、陨石)。
- **NPC**:对话、商店、入住房屋、随进度解锁。

架构原则(按优先级):

1. **数据驱动**:新内容(方块/物品/武器/生物)= 在注册表加一条数据 + 必要的贴图/图标,
   不改游戏规则代码。规则代码只认注册表字段,不认具体 id。
2. **系统化**:每个游戏规则是一个"系统"模块(拥有自己的状态 + `update(dt)`),
   main.ts 只做组装与接线,不写规则。
3. **事件解耦**:跨系统的"发生了什么"(方块被破坏、生物被击杀、玩家死亡……)走事件总线;
   系统之间不互相直接调用非本职方法。
4. **纯逻辑可测**:物理、战斗结算、库存、生成算法保持与 DOM/Three.js 分离,
   能在 vitest 里裸测(现有 moveMob/WaterSim/chest 的风格)。
5. **兼容不变量**(见 §6):id 空间、存档 key、`__game` 调试接口、测试路径不破坏。

**反目标**:不引入通用 ECS 框架、不追求完美抽象。抽象只在"第二个使用者出现"时提炼
(弹幕/boss/NPC 都是已知的第二使用者,因此实体层现在就值得建)。

---

## 2. 分层架构

依赖方向自上而下(上层可 import 下层,禁止反向;同层之间尽量走事件/回调):

```
┌─ 入口层  main.ts                     组装根:构造、接线、主循环调度(目标 < 400 行)
├─ 系统层  src/game/*.ts               游戏规则:combat / mining / interact / inventory /
│                                      crafting / tnt / ambience / spawner(未来: bosses / npcs)
├─ 实体层  src/game/entities.ts        统一实体生命周期;projectiles / drops / falling / mobs
├─ UI 层   src/ui/*.ts + hud.ts        面板管理(模态栈+指针锁)、HUD 部件、touch
├─ 内容层  src/content/*.ts + blocks/tools  注册表:物品(含武器)、方块、配方、战利品、图鉴
├─ 核心层  src/core/*.ts               事件总线、存档分节、世界旗标(无游戏语义)
└─ 世界层  world / chunk / worldgen / structures / lights / water / noise / player(物理)
   渲染层  textures / blockmesh / particles / sky / playermodel / sound(被各层使用)
```

现有文件 → 层的映射(**保持文件路径不动**,tests/ 直接 import 这些路径):

| 层 | 文件 |
|---|---|
| 世界 | `world.ts` `chunk.ts` `worldgen.ts` `structures.ts` `noise.ts` `lights.ts` `water.ts` `player.ts` `config.ts` |
| 实体 | `mobs.ts`(生物) `items.ts`(掉落物) `falling.ts`(重力方块) |
| 内容 | `blocks.ts` `tools.ts`(id 常量与旧接口,数据并入 `content/items.ts`) |
| 渲染 | `textures.ts` `blockmesh.ts` `particles.ts` `sky.ts` `playermodel.ts` `daynight.ts` `sound.ts` |
| UI | `hud.ts` `touch.ts` `controls.ts` |

新代码放入 `src/core/` `src/content/` `src/game/` `src/ui/`;旧文件在自然重写时才迁移。

---

## 3. 核心机制

### 3.1 事件总线(`src/core/events.ts`)

类型化的发布/订阅。事件是**已经发生的事实**,过去式命名;
监听者不得假定彼此顺序。载荷保持扁平小对象。

```ts
interface GameEvents {
  blockBroken: { x; y; z; id; byPlayer: boolean };
  blockPlaced: { x; y; z; id };
  explosion: { x; y; z; radius };
  mobDamaged: { kind; x; y; z; hp; dmg };
  mobKilled: { kind; x; y; z };            // boss 召唤计数、任务、掉落都挂这里
  playerDamaged: { dmg; hp; source };
  playerDied: { source };
  playerRespawned: {};
  itemPickedUp: { id; count };
  itemCrafted: { recipe; result; count };      // 合成成功(成就/任务/解锁挂这里)
  chestOpened: { x; y; z; loot: string };
  flagChanged: { key; value };              // 世界进度(boss 击败等)
}
```

用途示例:僵尸死亡音效/粒子不再由 main 手工接线,而是 ambience/particles 各自订阅
`mobKilled`;未来"击败血肉墙 → 世界进入困难模式"就是 `mobKilled` 的一个监听者。

### 3.2 世界旗标(`src/game/flags.ts`)

`Flags`:持久化的 `Record<string, number | boolean>` + 读写 API + `flagChanged` 事件。
**一切世界进度**(boss 是否击败、事件是否触发、NPC 是否解锁)都存这里,随存档保存。
命名约定:`boss.eyeOfCthulhu.defeated`、`event.bloodMoon.count`、`npc.guide.unlocked`。

### 3.3 存档分节(`src/core/save.ts`)

`SaveManager`:各系统注册 `{ key, save(): unknown, load(data: unknown): void }`。
落盘仍是单个 localStorage 条目 `mc-demo-save-v1`,顶层字段名 = 分节 key,
**与历史存档字段一一对应**(edits/player/counts/time/hotbar/hp/creative/stash/chests),
旧档无缝读取。新系统加存档 = 注册一个分节,不改别人的代码。
分节 `load` 必须容忍 undefined/坏数据(玩家可能带着旧档升级)。

### 3.4 统一物品注册表(`src/content/items.ts`)

方块物品与工具/武器共用一个 id 空间(§6.1)与一张注册表:

```ts
interface ItemDef {
  id: number;
  name: string;
  kind: 'block' | 'tool' | 'weapon' | 'armor' | 'accessory' | 'material' | 'consumable';
  desc?: string;                    // 图鉴/悬浮提示
  icon(): HTMLCanvasElement;        // 惰性生成,内部缓存
  maxStack?: number;                // 单堆上限(装备/饰品 = 1,缺省 999)
  block?: number;                   // kind=block:对应方块 id(通常等于自身)
  toolClass?: 'pickaxe' | 'axe';    // 挖掘加速类别
  toolPower?: number;               // 挖掘倍速(镐/斧 = 3)
  weapon?: WeaponDef;               // kind=weapon 必填
  armor?: ArmorDef;                 // kind=armor:{slot: head|body|legs, defense}
  accessory?: AccessoryDef;         // kind=accessory:{stats: 属性加成}(见 §3.8b)
}

interface WeaponDef {
  damage: number;                   // 基础伤害(徒手 = 1)
  knockback: number;                // 击退强度
  cooldown: number;                 // 攻击间隔(秒)
  swingArc?: number;                // 近战扇形角(弧度);有值则挥砍可命中弧内多个目标
  projectile?: ProjectileSpawn;     // 挥动时发射弹幕(泰拉之刃剑气)
  orbit?: OrbitSpawn;               // 环绕剑(天顶剑):数量/半径/追踪
  noMining: true;                   // 武器不能挖掘(现"剑不能挖"泛化)
}
```

**规则代码一律查注册表**:挖掘加速查 `toolClass/toolPower`,攻击伤害查 `weapon.damage`,
"手持剑不能挖"查 `weapon.noMining`。今后加泰拉之刃 = 注册一条
`{ kind:'weapon', weapon:{ damage:9, swingArc:2.1, projectile:{...} } }` + 图标,
战斗系统零改动。图鉴(codex)条目也从注册表自动派生。
`kind:'material'`(锭/凝胶类)是纯合成材料:不可放置、无使用行为,
仅作为配方(§3.8d)的输入/产物流经背包与掉落物管线。

### 3.5 实体层(`src/game/entities.ts`)

主动实体(有每帧行为、会生灭的世界对象)的统一生命周期:

```ts
interface Entity {
  update(dt: number): boolean;      // 返回 false = 死亡,管理器负责 dispose
  dispose(): void;                  // 摘除 Object3D、释放材质
  setBrightness?(b: number): void;  // 昼夜亮度广播
}
class EntityManager { add(e); update(dt); setBrightness(b); clear() }
```

- 已迁入:点燃的 TNT(`game/tnt.ts`)。
- **弹幕**(`game/projectiles.ts`):位置+速度+重力系数,逐帧对方块(体素步进)与
  生物(AABB)命中;命中回调走战斗管线。武器剑气、boss 弹幕、召唤物攻击共用。
- 生物(mobs)/掉落物(drops)/重力方块(falling)保持现有类,由 main 以同样节奏驱动;
  重写时再并入管理器,不为合并而合并。

### 3.6 战斗管线(`src/game/combat.ts`)

所有伤害的唯一入口,两个方向:

- `hurtPlayer(dmg, source, knockDir?)`:创造豁免 → 扣血/击退/音效/红闪 → `playerDamaged`
  → 归零重生 `playerDied`。岩浆/摔落/僵尸/(未来 boss、弹幕)全部走这里。
- `hurtMob(hit, opts)`:由玩家近战/弹幕/爆炸调用;伤害与击退从 **持有物品的 WeaponDef** 结算,
  不再散落 `=== Tool.Sword` 判断。未来的暴击、无敌帧、伤害数字都加在这一个函数里。

近战攻击入口 `meleeAttack()`:读当前手持武器 → 单体射线(无 swingArc)或扇形多目标
(有 swingArc)→ `hurtMob` → 触发 `projectile` 弹幕。boss 的受击共享同一管线。

### 3.7 交互注册表(`src/game/interact.ts`)

点按(useAt)不再是 if-chain,而是注册表分发:

```ts
registerBlockUse(Block.Chest, (hit, ctx) => openChest(hit));
registerBlockUse(Block.TNT,   (hit, ctx) => 手持打火石 ? ignite(hit) : false);
// 未来:门(开关)、祭坛(合成)、恶魔之心(召唤 boss)、床(重生点)……
```

分发顺序:实体交互(生物/NPC,近者优先)→ 方块 use 注册表 → 手持物品 use
(武器→挥击,方块→放置)。NPC 对话就是"实体交互"的一个注册项。

### 3.8b 属性表与装备(`src/game/stats.ts` + `src/game/equipment.ts`)

**一切改写玩家数值的东西(盔甲/饰品,未来:药水 buff、套装加成)都汇入一张
属性表**,规则系统只读聚合结果,不认具体装备:

```ts
interface StatSheet {
  defense: number;      // 伤害减免:实际伤害 = max(1, dmg - defense/2)(泰拉公式)
  maxHp: number;        // 基础 10
  moveSpeed: number;    // 乘数(饰品加成累加:1 + Σ加成)
  jumpBoost: number;    // 乘数
  miningSpeed: number;  // 乘数
  meleeDamage: number;  // 乘数
  extraJumps: number;   // 空中额外跳(云朵瓶式)
  noFallDamage: boolean;// 幸运马蹄铁式
}
```

- `Equipment`:8 个装备槽(头/身/腿 + 5 饰品),放入/取下即 `recompute()`
  聚合出缓存 StatSheet;槽型校验(头盔只进头槽,饰品只进饰品槽)。
- 消费方:Player 物理读 moveSpeed/jumpBoost/extraJumps;combat 读
  defense/maxHp/meleeDamage/noFallDamage;interact 挖掘读 miningSpeed。
  **加一件新装备 = 注册 ItemDef(armor/accessory 字段)+ 图标,规则零改动**;
  需要全新行为(如冲刺盾)才加 StatSheet 字段 + 对应系统各改一处。
- 装备槽是背包面板里的一列(拖放同一套 lift/drop),存档分节 'equip'。

### 3.8c 世界事件(`src/content/events.ts` + `src/game/worldevents.ts`)

血月/南瓜月式的全局事件 = **一条声明式定义 + 生效期间的修饰集**:

```ts
interface WorldEventDef {
  id: string; name: string;
  nightChance: number;        // 黄昏触发概率(0 = 仅召唤物/调试触发)
  endsAtDawn: boolean;        // 黎明自动结束(波次型事件用进度结束,见路线图)
  fogTint?: { color; strength }; // 氛围修饰(血月红雾)
  spawnRateMul: number;       // 刷怪频率倍数
  spawnCapMul: number;        // 刷怪上限倍数
  startMsg / endMsg;          // 公告
}
```

- `WorldEvents` 系统:黄昏沿(starAlpha 升穿 0.5)掷骰触发、黎明沿结束;
  `start(id)/stop()` 供召唤物(交互注册表)与调试;活动事件随存档恢复。
- 修饰的消费方:Mobs 读 `spawnRateMul/spawnCapMul`,ambience 读
  `eventFogTint`,声景/刷怪表等未来修饰同模式扩展。
- 触发/结束广播 `worldEventStarted/Ended`(事件总线)+ `flags` 计数
  (`event.bloodMoon.count`),为成就/进度留钩子。
- **血月是参考实现**;南瓜月式波次事件在此上加 `waves` 进度字段(§8.路线图)。

### 3.8d 合成系统(`src/content/recipes.ts` + `src/game/crafting.ts`)

泰拉瑞亚合成模型:**配方是声明式数据**,系统只做三件事 —— 扫站台、算可合成、原子结算:

```ts
interface RecipeDef {
  id: string;                                    // 稳定标识('iron-bar'),e2e/事件/成就用
  result: number; count: number;                 // 产物(物品 id + 数量)
  ingredients: { id: number; count: number }[];  // 配料(任意注册物品:方块/材料/装备…)
  stations: number[];                            // 所需合成站方块 id,须全部在附近;[] = 徒手
}
```

- **站台就是方块**:配方引用哪个方块 id,哪个方块就是合成站(工作台/熔炉/铁砧,
  未来:祭坛/炼药桌)。BlockDef 上不加任何标记 —— `stationBlocks()` 从配方表反推
  站台集合,`scanStations()` 只对这个集合做玩家周边扫描(水平 ±3、垂直 ±2,
  泰拉式"站在旁边即可用")。
- **可合成判定是纯函数**:`craftableTimes(slots, recipe)` 对全部 50 格计数。
  列表 = 站台满足的配方(材料不足显示灰条不可点,站台不满足整条隐藏,引导找站台)。
- **原子事务**:`performCraft` 校验 → 扣料 → 交付,任何一步失败整体回滚,
  物品绝不凭空消失/出现。交付泰拉式:背包面板开着 → 产物落到**手中堆**
  (同 id 并入,手持异物拒绝);面板关着(调试/e2e)→ 直接入包,放不下拒绝。
- **UI 是背包面板的一个分区**(泰拉式合成列表),由 `inventory.onBagRefresh` 驱动
  重算 —— 每次格子变动都会重绘背包,列表随之刷新;面板开着时无法改世界,
  站台扫描结果不会失效。创造模式 E 面板是调色板,无合成列表。
- 成功后广播 `itemCrafted`(总线)+ 音效;成就/任务/配方统计都挂事件。
- 配方解锁条件(击败 boss 后可锻)= RecipeDef 加 `flag?` 字段 + 列表过滤一处,
  留给 boss 系统;"就近宝箱取材"= 判定与扣料的槽位来源多传一组,接口已按
  slots 数组抽象。加配方/站台见 §4.10。

### 3.8 UI 面板管理(`src/ui/panels.ts`)

模态面板(背包/宝箱/图鉴/未来的对话/商店/合成)统一注册:
`panels.register(name, { el, onOpen?, onClose? })` + `open/close/toggle`。
管理器保证:同刻至多一个面板、Esc/E/点暗背景语义一致、指针锁的释放与重锁集中处理
(桌面 exitPointerLock / 触屏软锁)。**boss 血条、伤害数字等非模态 HUD 部件**直接加在
`hud.ts`,不进面板栈。

---

## 4. 扩展手册(Playbooks)

> 每类内容"怎么加"。加完跑 §5 验证清单。

### 4.1 加一种方块

1. `textures.ts`:画 16px 贴图,`Tile` 加格(图集 8 列,行数 `ATLAS_ROWS` 自适应)。
2. `blocks.ts`:`Block` 加 id(顺延),`BLOCK_DEFS` 加定义(硬度/透明/光照/重力/sway…);
   可放置则加入 `PLACEABLE`。
3. `content/items.ts` 会自动把可放置方块收进物品注册表与图鉴;特殊说明写 `desc`。
4. 若参与世界生成:worldgen/structures 按位置规则放置。
5. 导出物品图标到 `scripts/items/`,截图入 `scripts/shots/`。

### 4.2 加一件武器(以泰拉之刃为例)

1. `tools.ts`:`Tool` 加 id(≥100 空间顺延)。
2. `textures.ts`:画 16px 武器图标(`paintTool`)。
3. `content/items.ts`:注册 `{ kind:'weapon', weapon:{ damage, knockback, cooldown,
   swingArc, projectile:{ speed, life, damage, gravity:0, pierce } } }`。
4. 获取途径:宝箱战利品表 / 合成配方(§4.10)。
5. **不需要**改 combat/mining/interact——它们只读注册表。
   天顶剑类环绕武器:`weapon.orbit` + projectiles 的追踪模式(§3.5)。

### 4.3 加一种生物

`mobs.ts` 的 `SPECIES` 加条目(hp/速度/碰撞盒/敌对),`buildModel` 按 kind 分支搭盒模型
+ `textures.buildMobTextures` 加皮肤;生成规则在 spawner(按层/群系/昼夜/光照)。
死亡掉落:监听 `mobKilled` spawn drops。快照入 `scripts/shots/`。

### 4.4 加一个 boss(未来 `src/game/bosses.ts`)

- BossDef:部件列表(各自 AABB/贴图/血量或共享血池)、阶段(hp 阈值 → 行为参数)、
  攻击模式(位移 AI + `projectiles` 弹幕)、召唤条件(交互注册表:恶魔之心/祭坛)、
  掉落(战利品表)、击败旗标(`flags.set('boss.x.defeated')`)。
- 复用:受击走 `combat.hurtMob`(部件转发到血池)、弹幕走 projectiles、
  血条是 hud 部件、进度走 flags、入场/死亡广播走事件。
- **先做单部件 boss(克苏鲁之眼式)打通全链,再做多部件。**

### 4.5 加一个 NPC(未来 `src/game/npcs.ts`)

- NpcDef:名字/皮肤/对话树/商店表(卖出=从 stash 扣,买入=addToSlots)/解锁旗标。
- 实体交互注册"对话",对话/商店是 panels 的两个面板;入住判定(房屋检测)是独立
  纯函数,单测覆盖。存档:npcs 分节(位置+解锁态)。

### 4.6 加世界事件(血月/陨石)

`src/game/events-world.ts`(未来):条件(时间/旗标/概率)→ 广播事件 → 各系统响应
(spawner 换刷怪表、ambience 换雾色音景、worldgen 落陨石=批量 setBlock)。

### 4.7 加一件装备 / 饰品(§3.8b)

1. `tools.ts` 加 id(100+ 空间顺延),`textures.ts` 画 16px 图标(paintTool)。
2. `content/items.ts` 注册:盔甲 `{ kind:'armor', maxStack:1, armor:{slot,defense} }`,
   饰品 `{ kind:'accessory', maxStack:1, accessory:{ stats:{ moveSpeed:0.25 } } }`。
3. 获取途径入战利品表(structures.CHEST_LOOT)或合成配方(§4.10)。
4. **不需要**改 equipment/combat/player —— 属性经 StatSheet 聚合自动生效;
   只有全新行为(新 StatSheet 字段)才碰对应系统。图鉴自动收录。

### 4.8 加一个世界事件(§3.8c,血月为参考实现)

1. `content/events.ts` 注册 WorldEventDef(触发概率/结束条件/修饰集/公告)。
2. 特殊触发(召唤物)= 交互注册表调 `worldEvents.start(id)`。
3. 新修饰类型(换刷怪表/换音乐):WorldEventDef 加字段 + 消费系统读一处。
4. e2e:`__game.worldEvents.start/stop` 确定性驱动。

### 4.10 加一条合成配方 / 加一个合成站(§3.8d)

配方:`content/recipes.ts` 里 `registerRecipe({ id, result, count, ingredients, stations })`
一条数据即完成 —— 列表/判定/结算/UI 全自动,**不改 crafting/inventory/hud**。
配料与产物可以是任意注册物品(方块/工具/武器/装备/材料)。

新材料物品(锭/凝胶类):`tools.ts` 的 `Mat` 加 id(130+ 顺延)→ `textures.ts`
`paintTool` 画 16px 图标 → `content/items.ts` 注册 `{ kind:'material' }`
(不可放置,自动进背包/掉落物/图鉴管线)。

新合成站:按 §4.1 加一种方块(贴图/BLOCK_DEFS/PLACEABLE),再在配方的
`stations` 里引用它 —— **被引用即成为站台**,无需其他注册。站台自身的获取
也走配方,形成泰拉式站台链(工作台徒手 → 熔炉要工作台 → 铁砧要熔炉炼的锭)。
e2e 契约:`__game.craft.list/craft/stations`。

### 4.9 加存档字段 / 加面板

存档:系统内 `save.register('mySection', {save, load})`,**禁止**改别人的分节。
面板:index.html 加 DOM + `panels.register`,开合/锁指针自动获得。

---

## 5. 验证清单(每次改动)

1. `npm test` — 单元测试(纯逻辑必须有单测;新系统照 chest/moveMob 的风格写)。
2. `npm run build` — 类型 + 构建。
3. `npm run dev` 起服 → `npm run verify` — e2e 实机游玩(新玩法补 e2e 用例)。
4. 视觉改动:截图入 `scripts/shots/` 人工复核;新物品图标入 `scripts/items/`。
5. 更新 `skills/progress.md`,git 提交。

## 6. 不变量(破坏 = 事故)

1. **id 空间**:方块 `0..99`(现用到 56),物品 `100+`:工具/武器 `100-109`、
   装备 `110-119`、饰品 `120-129`、材料 `130+`(现用到 130)。
   id 只增不改不删——存档里存的是裸 id。方块朝向变体(南瓜式)占连续 id 并提供
   `baseBlock` 归一化。
2. **存档**:key `mc-demo-save-v1`、顶层字段含义不变;字段只增;`load` 容忍缺失。
   改造存档结构必须写迁移并保留旧档读取。
3. **`__game` 调试接口**(?test 模式):现有字段/方法签名只增不改——
   61 项 e2e 全依赖它。
4. **测试 import 路径**:`tests/*.test.ts` 直接 import `../src/<file>`;
   这些文件的公开导出保持稳定(内部实现随便改)。
5. **确定性**:世界生成只用种子哈希/噪声,禁止 `Math.random`(装饰性粒子除外);
   同种子必须同世界。
6. **性能预算**:地表 55+ FPS / 地狱 45+ FPS(里程碑 37 的剔除与增量光照不可回退);
   每帧新增分配尽量为零(复用向量/数组)。

## 7. 路线图

**A. 架构落地(本轮)**:core(事件/存档/旗标)→ 物品注册表 → main.ts 拆系统
→ 实体层+弹幕 → 面板管理器。每步全量验证 + 提交。

**A2. 属性/装备/事件骨架(里程碑 57 落地)**:StatSheet 属性管线 + 装备/饰品槽
(铁甲三件 + 饰品为参考实现)+ 世界事件系统(血月为参考实现)。
后续:套装加成(armor set 检测)→ 更多饰品行为字段(冲刺/水上行走)→
波次事件(南瓜月:WorldEventDef 加 waves/score,黎明结算)→ 事件专属刷怪表与掉落
→ 药水 buff(同一 StatSheet 聚合,带时限来源)。

**A3. 合成系统骨架(里程碑 58 落地)**:配方注册表(§3.8d)+ 合成站三件
(工作台/熔炉/铁砧,站台链)+ 材料类物品(铁锭)+ 背包面板合成分区。
参考实现:原木→木板→工作台→熔炉→铁锭→铁砧→铁甲三件(泰拉进阶闭环)。
后续:武器/饰品配方树(接 B 段)→ 配方解锁条件(flag,接 boss 进度)→
祭坛类特殊站台(仅世界生成、不可放置)→ 药水/食物(consumable)→ 就近宝箱取材。

**B. 武器系统**:近战扇形挥砍与冷却 → 弹幕武器(剑气)→ 武器分级与战利品分布
→ 泰拉之刃 → 天顶剑(环绕+追踪)。伤害数字、命中音效打磨。获取全面走 §4.10 配方
(锭分级:铁→金→…)+ 战利品表。

**C. boss 系统**:boss 框架(血池/阶段/血条/召唤/掉落/旗标)→ 第一个 boss
(克苏鲁之眼式单体,血腥地恶魔之心召唤)→ 多部件 boss(骷髅王式)→ 击败推进世界进度。

**D. NPC 与大世界交互**:门/祭坛等交互方块 → NPC 框架(对话/商店/入住)。
(世界事件已落地 §3.8c;合成系统已落地 §3.8d,祭坛作为特殊站台在此接入。)

**E. 持续**:每阶段保持"可玩、稳定、像泰拉瑞亚"三条底线(CLAUDE.md 优先级)。
