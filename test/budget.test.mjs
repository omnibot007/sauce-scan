import { describe, expect, it } from 'vitest';

import { Budget, fmtDuration, parseDuration } from '../src/budget.mjs';

function fakeClock(start = 0) {
  const state = { t: start };
  return { now: () => state.t, advance: (ms) => { state.t += ms; }, state };
}

describe('parseDuration', () => {
  it('parses the shapes an operator actually types', () => {
    expect(parseDuration('15m')).toBe(900_000);
    expect(parseDuration('90s')).toBe(90_000);
    expect(parseDuration('2h')).toBe(7_200_000);
    expect(parseDuration('500ms')).toBe(500);
    expect(parseDuration('1200')).toBe(1200);
  });

  it('falls back rather than throwing mid-hunt', () => {
    expect(parseDuration('banana', 42)).toBe(42);
    expect(parseDuration(undefined, 42)).toBe(42);
    expect(parseDuration('', 42)).toBe(42);
  });
});

describe('fmtDuration', () => {
  it('reads like a human wrote it', () => {
    expect(fmtDuration(450)).toBe('450ms');
    expect(fmtDuration(45_000)).toBe('45s');
    expect(fmtDuration(185_000)).toBe('3m05s');
  });
});

describe('Budget wall clock', () => {
  it('tracks elapsed and remaining', () => {
    const c = fakeClock();
    const b = new Budget({ wallMs: 1000, now: c.now });
    expect(b.remainingMs()).toBe(1000);
    c.advance(400);
    expect(b.elapsedMs()).toBe(400);
    expect(b.remainingMs()).toBe(600);
    expect(b.exhausted()).toBe(false);
  });

  it('refuses a batch it cannot afford instead of overrunning', () => {
    const c = fakeClock();
    const b = new Budget({ wallMs: 1000, now: c.now });
    expect(b.affords(500)).toBe(true);
    c.advance(800);
    expect(b.affords(500)).toBe(false);
    expect(b.affords(100)).toBe(true);
  });

  it('reports exhaustion and records skips with reasons', () => {
    const c = fakeClock();
    const b = new Budget({ wallMs: 100, now: c.now });
    c.advance(150);
    b.skip('swh', 'no time left');
    const r = b.report();
    expect(r.exhausted).toBe(true);
    expect(r.remainingMs).toBe(0);
    expect(r.skipped[0].what).toBe('swh');
  });
});

describe('Budget gh token bucket', () => {
  it('grants up to the per-minute cap without waiting', async () => {
    const c = fakeClock();
    const b = new Budget({ wallMs: 60_000, ghPerMin: 3, now: c.now });
    expect(await b.takeGhSlot()).toBe(true);
    expect(await b.takeGhSlot()).toBe(true);
    expect(await b.takeGhSlot()).toBe(true);
    expect(b.report().spend.gh).toBe(3);
  });

  it('refuses rather than waiting past the wall clock', async () => {
    const c = fakeClock();
    // Only 10ms of budget left, but the bucket is full: waiting would overrun.
    const b = new Budget({ wallMs: 10, ghPerMin: 1, now: c.now });
    expect(await b.takeGhSlot()).toBe(true);
    expect(await b.takeGhSlot()).toBe(false);
  });

  it('frees slots once the window rolls', async () => {
    const c = fakeClock();
    const b = new Budget({ wallMs: 10 * 60_000, ghPerMin: 2, now: c.now });
    await b.takeGhSlot();
    await b.takeGhSlot();
    c.advance(61_000);
    expect(await b.takeGhSlot()).toBe(true);
  });
});
