# Terraria 3D — 架构蓝图

> 本文档是项目的**长期架构基准**。所有新功能(武器、boss、NPC、大世界交互等)必须按本文的
> 分层与扩展点接入;发现架构不适配时,先改本文档、再改代码。
> 配套阅读:`CLAUDE.md`(愿景与工作方式)、`skills/progress.md`(逐里程碑进度)。

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
│                                      tnt / ambience / spawner(未来: bosses / npcs / events)
├─ 实体层  src/game/entities.ts        统一实体生命周期;projectiles / drops / falling / mobs
├─ UI 层   src/ui/*.ts + hud.ts        面板管理(模态栈+指针锁)、HUD 部件、touch
├─ 内容层  src/content/*.ts + blocks/tools  注册表:物品(含武器)、方块、战利品、图鉴
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
  kind: 'block' | 'tool' | 'weapon' | 'material' | 'consumable';
  desc?: string;                    // 图鉴/悬浮提示
  icon(): HTMLCanvasElement;        // 惰性生成,内部缓存
  block?: number;                   // kind=block:对应方块 id(通常等于自身)
  toolClass?: 'pickaxe' | 'axe';    // 挖掘加速类别
  toolPower?: number;               // 挖掘倍速(镐/斧 = 3)
  weapon?: WeaponDef;               // kind=weapon 必填
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
4. 获取途径:宝箱战利品表 / 合成(未来)。
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

### 4.7 加存档字段 / 加面板

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

1. **id 空间**:方块 `0..99`(现用到 53),物品/工具/武器 `100+`(现用到 103)。
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

**B. 武器系统**:近战扇形挥砍与冷却 → 弹幕武器(剑气)→ 武器分级与战利品分布
→ 泰拉之刃 → 天顶剑(环绕+追踪)。伤害数字、命中音效打磨。

**C. boss 系统**:boss 框架(血池/阶段/血条/召唤/掉落/旗标)→ 第一个 boss
(克苏鲁之眼式单体,血腥地恶魔之心召唤)→ 多部件 boss(骷髅王式)→ 击败推进世界进度。

**D. NPC 与大世界交互**:门/祭坛等交互方块 → NPC 框架(对话/商店/入住)→
世界事件(血月)→ 合成系统(祭坛/工作台界面)。

**E. 持续**:每阶段保持"可玩、稳定、像泰拉瑞亚"三条底线(CLAUDE.md 优先级)。
