# 工作记忆(每轮必读,保持精炼;过期就删)

## 架构(里程碑 52 起生效)

- **新功能必须按 `ARCHITECTURE.md` 的扩展点接入**,不要往 main.ts 加规则代码。
  main.ts 只做组装(现 611 行,保持这个量级)。
- 加内容的入口速查:
  - 方块 → `blocks.ts` + `textures.ts`(§4.1);物品/**武器** → `content/items.ts`
    注册 ItemDef/WeaponDef(§4.2,战斗/挖掘自动生效);
  - 点按交互(门/祭坛/恶魔之心)→ `interact.registerBlockUse`;
  - 弹幕(剑气/boss 攻击)→ `game/projectiles.ts` 的 spawn(spec);
  - 世界进度(boss 击败等)→ `game/flags.ts`(自动入档+广播);
  - 存档新字段 → `save.register('分节', {save,load})`,禁改别人的分节;
  - 模态 UI(对话/商店)→ `ui/panels.ts` register;非模态 HUD 件 → `hud.ts`;
  - 跨系统通知 → `core/events.ts`(已有 mobKilled/playerDied/blockBroken 等)。
- **不变量(ARCHITECTURE.md §6,破坏 = 事故)**:方块 id 0..99 / 物品 100+ 只增不改;
  存档 key `mc-demo-save-v1` 字段只增;`__game` 调试接口只增不改(61 项 e2e 依赖);
  `tests/*.test.ts` 直接 import `../src/<file>`,这些文件的公开导出保持稳定;
  世界生成禁 Math.random;性能预算地表 55+/地狱 45+ FPS。

## 验证流程

- `npm test`(101 单测)→ `npm run build` → 起 `npm run dev`(5173)后
  `npm run verify`(61 项 e2e,需连续两轮全绿)。
- verify 脚本会清 localStorage 重开世界;新玩法要补 e2e 用例 + 截图入 scripts/shots。

## 用户的长期方向(下一步从这里选)

1. **武器系统**:近战扇形挥砍(WeaponDef.swingArc 已留)→ 剑气弹幕(projectile 字段)
   → 武器分级入战利品表 → 泰拉之刃 → 天顶剑(orbit 环绕+追踪,需在 projectiles
   加追踪模式)。
2. **boss 系统**:按 §4.4 —— 先单体 boss(克苏鲁之眼式)打通
   召唤(血腥地手指末端恶魔之心,交互注册)→ AI+弹幕 → 血条(hud)→ 掉落 →
   flags 记击败;再做多部件(骷髅王式)。
3. **NPC**(§4.5):对话/商店面板 + 入住房屋判定(纯函数可单测)。
4. **大世界交互/世界事件**(§4.6):血月(spawner 换表+氛围变调)。

## 踩坑备忘

- 面板开合牵扯指针锁,一律走 `ui/panels.ts`,不要手写 exitPointerLock。
- 玩家开机位置在 warmup 后经"嵌墙自救"校验,所以 'player' 分节是
  peek 一次性消费,load 为空 —— 不要"修复"它。
- 触屏(touch)与桌面共用交互语义,改点按/长按逻辑要过触屏 e2e。
