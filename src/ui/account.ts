// UI 层 · 账号页签:注册 / 登录 / 登出 / 同步状态(BACKEND.md §6 客户端侧)
// 换身份 = 换世界:登录/注册/登出成功后冲刷存档并整页刷新,由 boot 重新对账。
import { PASSWORD_MIN, USERNAME_RE, type ApiError } from '../../shared/api';
import { backend } from '../core/backend';
import type { Account } from '../game/account';

const ERR_TEXT: Record<ApiError | 'network', string> = {
  invalid: '用户名或口令格式不对',
  taken: '用户名已被占用',
  bad_credentials: '用户名或口令错误',
  unauthorized: '会话已失效,请重新登录',
  no_save: '云端没有存档',
  conflict: '存档版本冲突',
  too_large: '存档过大',
  rate_limited: '尝试太频繁,请稍后再试',
  not_found: '接口不存在',
  network: '连不上服务器 —— 离线也可游客游玩',
};

export function initAccountPane(account: Account, saveGame: () => void): void {
  const status = document.getElementById('acc-status')!;
  const form = document.getElementById('acc-form')!;
  const userEl = document.getElementById('acc-user') as HTMLInputElement;
  const passEl = document.getElementById('acc-pass') as HTMLInputElement;
  const registerBtn = document.getElementById('acc-register') as HTMLButtonElement;
  const loginBtn = document.getElementById('acc-login') as HTMLButtonElement;
  const logoutBtn = document.getElementById('acc-logout') as HTMLButtonElement;
  const hint = document.getElementById('acc-hint')!;

  if (account.user) {
    status.textContent = `已登录:${account.user.username} — 进度自动同步到云端`;
    form.style.display = 'none';
    logoutBtn.style.display = 'block';
  }

  const setBusy = (busy: boolean) => {
    registerBtn.disabled = busy;
    loginBtn.disabled = busy;
    logoutBtn.disabled = busy;
  };

  const submit = async (mode: 'register' | 'login') => {
    const username = userEl.value.trim();
    const password = passEl.value;
    if (!USERNAME_RE.test(username)) {
      hint.textContent = '用户名需 3-24 位字母/数字/下划线/汉字';
      return;
    }
    if (password.length < PASSWORD_MIN) {
      hint.textContent = `口令至少 ${PASSWORD_MIN} 位`;
      return;
    }
    setBusy(true);
    hint.textContent = mode === 'register' ? '注册中…' : '登录中…';
    const r = await (mode === 'register'
      ? backend.register(username, password)
      : backend.login(username, password));
    if (!r.ok) {
      hint.textContent = ERR_TEXT[r.error] ?? '出错了,请重试';
      setBusy(false);
      return;
    }
    // 先把当前游客世界落盘(boot 对账时若云端无档会自动绑定它),再重启进世界
    saveGame();
    hint.textContent = `欢迎,${r.user.username}!正在载入你的世界…`;
    location.reload();
  };

  registerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    void submit('register');
  });
  loginBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    void submit('login');
  });
  passEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void submit('login');
  });

  logoutBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    setBusy(true);
    hint.textContent = '正在冲刷云存档并登出…';
    await account.flushNow(); // 未推送的改动先上云,换设备不丢
    await backend.logout();
    location.reload(); // 回到游客键的本地世界
  });
}
