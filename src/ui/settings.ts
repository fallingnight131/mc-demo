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
  const tabSettings = document.getElementById('tab-settings')!;
  const tabTutorial = document.getElementById('tab-tutorial')!;
  const paneSettings = document.getElementById('settings-pane')!;
  const paneTutorial = document.getElementById('tutorial-pane')!;
  const showPane = (which: 'settings' | 'tutorial') => {
    paneSettings.classList.toggle('open', which === 'settings');
    paneTutorial.classList.toggle('open', which === 'tutorial');
    tabSettings.classList.toggle('active', which === 'settings');
    tabTutorial.classList.toggle('active', which === 'tutorial');
  };
  tabSettings.addEventListener('click', (e) => {
    e.stopPropagation();
    showPane('settings');
  });
  tabTutorial.addEventListener('click', (e) => {
    e.stopPropagation();
    showPane('tutorial');
  });
  paneSettings.addEventListener('click', (e) => e.stopPropagation());

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
