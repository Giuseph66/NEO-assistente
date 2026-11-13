import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LongPressTracker } from './useLongPress';

describe('LongPressTracker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = () => {
    const calls: string[] = [];
    const t = new LongPressTracker(
      { onTap: () => calls.push('tap'), onLongPress: () => calls.push('long'), onHoldChange: (h) => calls.push(h ? 'hold+' : 'hold-') },
      450
    );
    return { t, calls };
  };

  it('quick press is a tap', () => {
    const { t, calls } = make();
    t.down();
    vi.advanceTimersByTime(120);
    t.up();
    t.click();
    expect(calls).toEqual(['hold+', 'hold-', 'tap']);
  });

  it('holding opens the menu and swallows the click on release', () => {
    const { t, calls } = make();
    t.down();
    vi.advanceTimersByTime(460);
    t.up();
    t.click();
    expect(calls).toEqual(['hold+', 'hold-', 'long']);
  });

  it('keyboard click (no pointer) is a tap', () => {
    const { t, calls } = make();
    t.click();
    expect(calls).toEqual(['tap']);
  });

  it('leaving the button cancels, and does not swallow the next keyboard click', () => {
    const { t, calls } = make();
    t.down();
    vi.advanceTimersByTime(200);
    t.cancel();
    vi.advanceTimersByTime(500);
    t.click();
    expect(calls).toEqual(['hold+', 'hold-', 'tap']);
  });

  it('after a hold released outside, the next click still works', () => {
    const { t, calls } = make();
    t.down();
    vi.advanceTimersByTime(500); // menu opens
    t.cancel(); // pointer moved to the menu and left the button
    t.click();
    expect(calls).toEqual(['hold+', 'hold-', 'long', 'tap']);
  });
});
