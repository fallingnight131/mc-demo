// UI 层 · 开始/暂停界面的设置与教程页签(创造模式/音效/灵敏度)
import type { Sound } from '../sound';

export interface SettingsDeps {
  sound: Sound;
  getCreative(): boolean;
  setCreative(v: boolean): void;
  getSens(): number;
  setSens(v: number): void;
}

/** 接线设置面板;点击一律 stopPropagation 以免落入"开始游戏" */
export function initSettings(deps: SettingsDeps): void {
  // 页签:设置 / 账号 / 教程(面板 DOM 见 index.html)
  const tabs = [
    { tab: document.getElementById('tab-settings')!, pane: document.getElementById('settings-pane')! },
    { tab: document.getElementById('tab-account')!, pane: document.getElementById('account-pane')! },
    { tab: document.getElementById('tab-tutorial')!, pane: document.getElementById('tutorial-pane')! },
  ];
  for (const t of tabs) {
    t.tab.addEventListener('click', (e) => {
      e.stopPropagation();
      for (const o of tabs) {
        o.pane.classList.toggle('open', o === t);
        o.tab.classList.toggle('active', o === t);
      }
    });
    if (t.pane.id !== 'tutorial-pane') t.pane.addEventListener('click', (e) => e.stopPropagation());
  }

  const optCreative = document.getElementById('opt-creative') as HTMLInputElement;
  optCreative.checked = deps.getCreative();
  optCreative.addEventListener('change', () => deps.setCreative(optCreative.checked));

  const optSound = document.getElementById('opt-sound') as HTMLInputElement;
  optSound.checked = !deps.sound.muted;
  optSound.addEventListener('change', () => {
    deps.sound.setMuted(!optSound.checked);
    try {
      localStorage.setItem('mc-demo-muted', deps.sound.muted ? '1' : '0');
    } catch {
      // 忽略
    }
  });

  const optSens = document.getElementById('opt-sens') as HTMLInputElement;
  const optSensVal = document.getElementById('opt-sens-val')!;
  optSens.value = String(deps.getSens());
  optSensVal.textContent = deps.getSens().toFixed(1);
  optSens.addEventListener('input', () => {
    const v = parseFloat(optSens.value) || 1;
    deps.setSens(v);
    optSensVal.textContent = v.toFixed(1);
    try {
      localStorage.setItem('mc-demo-sens', String(v));
    } catch {
      // 忽略
    }
  });
}

/** 读取跨会话的灵敏度设置(0.5~2) */
export function loadSensitivity(): number {
  try {
    const v = parseFloat(localStorage.getItem('mc-demo-sens') ?? '1');
    if (v >= 0.5 && v <= 2) return v;
  } catch {
    // 忽略
  }
  return 1;
}
