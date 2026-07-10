// 核心基建:事件总线 / 存档分节 / 世界旗标(ARCHITECTURE.md §3.1-3.3)
import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import { SaveManager, type KVStorage } from '../src/core/save';
import { Flags } from '../src/game/flags';

function memStorage(initial: Record<string, string> = {}): KVStorage & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe('event bus', () => {
  it('订阅收到载荷,退订后不再收到,互不影响', () => {
    const bus = new EventBus();
    const got: number[] = [];
    const off = bus.on('mobKilled', (p) => got.push(p.x));
    bus.on('mobKilled', (p) => got.push(p.x * 10));
    bus.emit('mobKilled', { kind: 'zombie', x: 1, y: 0, z: 0 });
    off();
    bus.emit('mobKilled', { kind: 'zombie', x: 2, y: 0, z: 0 });
    expect(got).toEqual([1, 10, 20]);
  });

  it('无订阅者的事件安全无害', () => {
    const bus = new EventBus();
    expect(() => bus.emit('playerDied', { source: 'lava' })).not.toThrow();
  });
});

describe('save manager', () => {
  it('分节往返:注册即加载旧数据,saveNow 落盘全部分节', () => {
    const store = memStorage({ save: JSON.stringify({ a: 41, b: [1, 2] }) });
    const sm = new SaveManager('save', store);
    expect(sm.read()).toBe(true);

    let a = 0;
    const bList: number[] = [];
    sm.register('a', { save: () => a + 1, load: (d) => (a = typeof d === 'number' ? d : 0) });
    sm.register('b', {
      save: () => bList,
      load: (d) => Array.isArray(d) && bList.push(...(d as number[])),
    });
    expect(a).toBe(41); // 注册即加载
    expect(bList).toEqual([1, 2]);

    sm.saveNow();
    expect(JSON.parse(store.map.get('save')!)).toEqual({ a: 42, b: [1, 2] });
  });

  it('无档/坏档按无档处理,分节 load 不被调用', () => {
    const store = memStorage({ save: '{oops' });
    const sm = new SaveManager('save', store);
    expect(sm.read()).toBe(false);
    let loaded = false;
    sm.register('x', { save: () => 1, load: () => (loaded = true) });
    expect(loaded).toBe(false);
  });

  it('reset 删档并阻断后续写回(清档不被自动存档写穿)', () => {
    const store = memStorage({ save: '{}' });
    const sm = new SaveManager('save', store);
    sm.read();
    sm.register('x', { save: () => 1, load: () => {} });
    sm.reset();
    sm.saveNow(); // beforeunload/visibilitychange 的兜底存档
    expect(store.map.has('save')).toBe(false);
  });

  it('markDirty 置位,saveNow 复位', () => {
    const sm = new SaveManager('save', memStorage());
    sm.markDirty();
    expect(sm.dirty).toBe(true);
    sm.saveNow();
    expect(sm.dirty).toBe(false);
  });
});

describe('world flags', () => {
  it('set/get/increment + flagChanged 事件 + 存档往返', () => {
    const bus = new EventBus();
    const events: Array<[string, number | boolean]> = [];
    bus.on('flagChanged', (p) => events.push([p.key, p.value]));

    const flags = new Flags(bus);
    flags.set('boss.eye.defeated', true);
    flags.increment('event.bloodMoon.count');
    flags.increment('event.bloodMoon.count', 2);
    flags.set('boss.eye.defeated', true); // 未变化不触发事件

    expect(flags.getBool('boss.eye.defeated')).toBe(true);
    expect(flags.getNum('event.bloodMoon.count')).toBe(3);
    expect(events).toEqual([
      ['boss.eye.defeated', true],
      ['event.bloodMoon.count', 1],
      ['event.bloodMoon.count', 3],
    ]);

    const restored = new Flags();
    restored.load(flags.save());
    expect(restored.getBool('boss.eye.defeated')).toBe(true);
    expect(restored.getNum('event.bloodMoon.count')).toBe(3);
    restored.load([['bad', 'value'], 'junk']); // 坏数据容忍
    expect(restored.get('bad')).toBeUndefined();
  });
});
