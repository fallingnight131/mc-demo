// WebAudio 程序化音效:不依赖任何音频文件
// 按方块材质分挖掘/破坏/放置/脚步声,另有入水声
import { Block } from './blocks';

type Material = 'stone' | 'wood' | 'soft' | 'sand' | 'glass' | 'snow';

/** 方块的声学材质分类(镐子加速判定也复用"石类") */
export function materialOf(blockId: number): Material {
  switch (blockId) {
    case Block.Stone:
    case Block.Cobble:
    case Block.Bedrock:
    case Block.Sandstone:
    case Block.Brick:
    case Block.StoneBrick:
    case Block.CoalOre:
    case Block.IronOre:
    case Block.GoldOre:
    case Block.DiamondOre:
    case Block.Obsidian:
    case Block.IronBlock:
    case Block.GoldBlock:
    case Block.DiamondBlock:
    case Block.EbonStone:
    case Block.Hellstone:
    case Block.DungeonBrick:
      return 'stone';
    case Block.Log:
    case Block.Plank:
    case Block.Chest:
    case Block.Pumpkin:
    case Block.PumpkinE:
    case Block.PumpkinN:
    case Block.PumpkinW:
      return 'wood';
    case Block.Sand:
      return 'sand';
    case Block.Snow:
      return 'snow';
    case Block.Glass:
      return 'glass';
    default:
      return 'soft'; // 草、泥土、树叶等
  }
}

interface NoiseOpts {
  duration: number;
  filterType: BiquadFilterType;
  freq: number;
  q?: number;
  gain: number;
  /** 滤波频率结束值(扫频) */
  freqEnd?: number;
}

const MASTER_GAIN = 0.5;

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private mutedFlag = false;
  private windGain: GainNode | null = null;
  private waterGain: GainNode | null = null;
  private rumbleGain: GainNode | null = null;
  private eerieGain: GainNode | null = null;

  get muted(): boolean {
    return this.mutedFlag;
  }

  setMuted(m: boolean): void {
    this.mutedFlag = m;
    if (this.master) this.master.gain.value = m ? 0 : MASTER_GAIN;
  }

  /** 需要用户手势后调用(指针锁定时) */
  unlock(): void {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.mutedFlag ? 0 : MASTER_GAIN;
        this.master.connect(this.ctx.destination);
        // 2 秒白噪声源:打击声共用,环境声循环播放(够长避免听出周期)
        const len = Math.floor(this.ctx.sampleRate * 2);
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        // 环境声通道:循环噪声 → 滤波 → 独立增益(音量由主循环设定)
        const mkLoop = (type: BiquadFilterType, freq: number, q: number): GainNode => {
          const src = this.ctx!.createBufferSource();
          src.buffer = this.noiseBuf;
          src.loop = true;
          const filter = this.ctx!.createBiquadFilter();
          filter.type = type;
          filter.frequency.value = freq;
          filter.Q.value = q;
          const gain = this.ctx!.createGain();
          gain.gain.value = 0;
          src.connect(filter).connect(gain).connect(this.master!);
          src.start();
          return gain;
        };
        this.windGain = mkLoop('lowpass', 320, 0.4);
        this.waterGain = mkLoop('bandpass', 950, 0.8);
        // 声景通道:地狱低频隆隆 / 腐化之地高 Q 呜咽
        this.rumbleGain = mkLoop('lowpass', 110, 0.6);
        this.eerieGain = mkLoop('bandpass', 220, 12);
      } catch {
        this.ctx = null;
        return;
      }
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  /** 环境声音量(0..1):风随海拔、流水靠近瀑布,平滑过渡 */
  setAmbience(wind: number, water: number): void {
    if (!this.ready || !this.windGain || !this.waterGain) return;
    const t = this.ctx!.currentTime;
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    this.windGain.gain.setTargetAtTime(clamp(wind) * 0.5, t, 0.5);
    this.waterGain.gain.setTargetAtTime(clamp(water) * 0.4, t, 0.3);
  }

  /** 声景音量(0..1):地狱隆隆 / 腐化呜咽,慢速过渡 */
  setScape(rumble: number, eerie: number): void {
    if (!this.ready || !this.rumbleGain || !this.eerieGain) return;
    const t = this.ctx!.currentTime;
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    this.rumbleGain.gain.setTargetAtTime(clamp(rumble) * 0.65, t, 0.8);
    this.eerieGain.gain.setTargetAtTime(clamp(eerie) * 0.22, t, 1.2);
  }

  /** 鸟鸣:两三声上扬颤音(森林/丛林白昼点缀) */
  chirp(vol = 1): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const n = 2 + ((Math.random() * 3) | 0);
    const f0 = 2300 + Math.random() * 1300;
    let t = ctx.currentTime + Math.random() * 0.1;
    for (let i = 0; i < n; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const f = f0 * (0.92 + Math.random() * 0.16);
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * (1.15 + Math.random() * 0.2), t + 0.045);
      osc.frequency.exponentialRampToValueAtTime(f * 0.9, t + 0.09);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.09 * vol, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      osc.connect(g).connect(this.master!);
      osc.start(t);
      osc.stop(t + 0.12);
      t += 0.11 + Math.random() * 0.08;
    }
  }

  /** 蟋蟀:一串短促高频脉冲(地表夜晚点缀) */
  cricket(): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const f = 4000 + Math.random() * 600;
    let t = ctx.currentTime + Math.random() * 0.05;
    const n = 3 + ((Math.random() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = f / 2;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = 8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.05, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
      osc.connect(bp).connect(g).connect(this.master!);
      osc.start(t);
      osc.stop(t + 0.05);
      t += 0.045;
    }
  }

  /** 滴水:高音水珠 + 微弱回声(地下/洞穴点缀) */
  drip(): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const f0 = 1100 + Math.random() * 700;
    const ping = (at: number, vol: number) => {
      const t = ctx.currentTime + at;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f0 * 0.45, t + 0.07);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.11 * vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      osc.connect(g).connect(this.master!);
      osc.start(t);
      osc.stop(t + 0.11);
    };
    ping(0, 1);
    ping(0.16 + Math.random() * 0.1, 0.35); // 洞里的回声
  }

  private get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running' && !!this.master && !!this.noiseBuf;
  }

  private noise(opts: NoiseOpts): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf!;
    src.playbackRate.value = 0.8 + Math.random() * 0.4; // 每次音色略有差异

    const filter = ctx.createBiquadFilter();
    filter.type = opts.filterType;
    filter.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqEnd) {
      filter.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + opts.duration);
    }
    filter.Q.value = opts.q ?? 1;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(opts.gain, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + opts.duration);

    src.connect(filter).connect(gain).connect(this.master!);
    src.start(t);
    src.stop(t + opts.duration + 0.02);
  }

  private knock(freq: number, duration: number, gainV: number): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * (0.92 + Math.random() * 0.16), t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.55, t + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainV, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(this.master!);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  /** 挖掘过程中的敲击声(比破坏轻) */
  hit(blockId: number): void {
    this.impact(blockId, 0.45);
  }

  /** 方块破碎 */
  break(blockId: number): void {
    this.impact(blockId, 1);
    const m = materialOf(blockId);
    if (m === 'glass') {
      this.noise({ duration: 0.3, filterType: 'highpass', freq: 2600, gain: 0.5 });
    } else {
      // 碎裂尾音
      this.noise({ duration: 0.22, filterType: 'lowpass', freq: 1400, freqEnd: 350, gain: 0.4 });
    }
  }

  /** 放置方块 */
  place(blockId: number): void {
    const m = materialOf(blockId);
    this.knock(m === 'stone' ? 170 : m === 'wood' ? 150 : 200, 0.1, 0.5);
    this.noise({ duration: 0.08, filterType: 'lowpass', freq: 900, gain: 0.3 });
  }

  /** 脚步声:低频短噪声 + 轻踏点,闷而短促(原版偏"沙沙"不像脚步) */
  step(blockId: number, loud = 1): void {
    const m = materialOf(blockId);
    const conf: Record<Material, [number, number]> = {
      stone: [480, 0.05],
      wood: [360, 0.055],
      soft: [380, 0.05],
      sand: [620, 0.06],
      snow: [520, 0.06],
      glass: [750, 0.045],
    };
    const [freq, dur] = conf[m];
    this.noise({
      duration: dur,
      filterType: 'lowpass',
      freq: freq * 2.2,
      freqEnd: freq * 0.8,
      gain: 0.2 * loud,
    });
    this.knock(m === 'soft' || m === 'snow' ? 72 : 95, 0.045, 0.12 * loud);
  }

  /** 入水声:低频"咚"+ 下扫水涌 + 轻微碎沫(原版上扫过尖) */
  splash(): void {
    this.knock(150, 0.14, 0.4);
    this.noise({ duration: 0.35, filterType: 'bandpass', freq: 1000, freqEnd: 320, q: 1, gain: 0.5 });
    this.noise({ duration: 0.28, filterType: 'lowpass', freq: 600, freqEnd: 240, gain: 0.35 });
    this.noise({ duration: 0.18, filterType: 'highpass', freq: 2200, gain: 0.08 });
  }

  /** TNT 引信嘶声 */
  fuse(): void {
    this.noise({ duration: 0.35, filterType: 'highpass', freq: 3200, gain: 0.22 });
  }

  /** 打火石擦火 */
  spark(): void {
    this.knock(2400, 0.05, 0.22);
    this.noise({ duration: 0.12, filterType: 'highpass', freq: 3800, gain: 0.3 });
  }

  /** 挥剑破风 */
  swing(): void {
    this.noise({ duration: 0.14, filterType: 'bandpass', freq: 1500, freqEnd: 500, q: 1.2, gain: 0.3 });
  }

  /** 爆炸(loud 按距离衰减 0..1) */
  explode(loud: number): void {
    this.noise({ duration: 0.9, filterType: 'lowpass', freq: 500, freqEnd: 60, gain: 0.95 * loud });
    this.noise({ duration: 0.3, filterType: 'bandpass', freq: 1100, q: 0.7, gain: 0.4 * loud });
    this.knock(55, 0.55, 0.85 * loud);
  }

  /** 单声"哞哞/咯咯"基元:振荡器 + 带通 + 包络,可选颤音 */
  private cry(
    at: number,
    type: OscillatorType,
    f0: number,
    dur: number,
    bp: number,
    vol: number,
    tremolo = 0,
  ): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0 * (0.9 + Math.random() * 0.2), t);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + dur);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = bp;
    filter.Q.value = 1.1;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.5 * vol, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(filter).connect(gain).connect(this.master!);
    if (tremolo > 0) {
      // 颤音:低频振荡调制音量(羊咩)
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 9;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.25 * vol * tremolo;
      lfo.connect(lfoGain).connect(gain.gain);
      lfo.start(t);
      lfo.stop(t + dur + 0.02);
    }
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** 生物叫声(vol 按距离衰减;hurt 时音调更高更急):僵尸低沉呻吟 */
  mobVoice(kind: 'zombie', vol: number, hurt = false): void {
    if (!this.ready || vol <= 0.02) return;
    void kind;
    this.cry(0, 'sawtooth', hurt ? 130 : 88, hurt ? 0.3 : 0.55, 260, vol * 1.1, 0.6);
  }

  /** 开箱:木盖吱呀 + 上行三音琶音(战利品!) */
  chest(): void {
    if (!this.ready) return;
    this.knock(120, 0.12, 0.4);
    this.noise({ duration: 0.18, filterType: 'bandpass', freq: 620, freqEnd: 900, q: 2.2, gain: 0.2 });
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + 0.1;
    for (const [i, f] of [660, 830, 1100].entries()) {
      const t = t0 + i * 0.09;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.22, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      osc.connect(gain).connect(this.master!);
      osc.start(t);
      osc.stop(t + 0.18);
    }
  }

  /** 玩家受击闷哼 */
  hurt(): void {
    this.knock(160, 0.12, 0.5);
    this.noise({ duration: 0.15, filterType: 'lowpass', freq: 700, freqEnd: 200, gain: 0.4 });
  }

  /** 拾取掉落物的"啵"声 */
  pop(): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.exponentialRampToValueAtTime(960, t + 0.09);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(gain).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.12);
  }

  private impact(blockId: number, loud: number): void {
    const m = materialOf(blockId);
    switch (m) {
      case 'stone':
        this.noise({ duration: 0.09, filterType: 'bandpass', freq: 760, q: 1.6, gain: 0.5 * loud });
        this.knock(190, 0.08, 0.32 * loud);
        break;
      case 'wood':
        this.knock(140, 0.1, 0.5 * loud);
        this.noise({ duration: 0.07, filterType: 'bandpass', freq: 420, q: 2, gain: 0.3 * loud });
        break;
      case 'glass':
        this.noise({ duration: 0.08, filterType: 'highpass', freq: 2400, gain: 0.35 * loud });
        break;
      case 'sand':
      case 'snow':
        this.noise({ duration: 0.1, filterType: 'highpass', freq: 1500, gain: 0.3 * loud });
        break;
      default:
        this.noise({ duration: 0.09, filterType: 'lowpass', freq: 1000, gain: 0.42 * loud });
    }
  }
}
