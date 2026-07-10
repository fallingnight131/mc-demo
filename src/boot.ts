// 入口引导:进世界之前完成账号探测与云/本地存档对账(BACKEND.md §6),
// 之后动态载入 main —— 游戏内核保持同步启动、不感知网络。
import { Account, initAccount } from './game/account';

(async () => {
  initAccount(await Account.boot());
  await import('./main');
})();
