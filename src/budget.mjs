/**
 * Budgets — wall clock and rate.
 *
 * Two hard facts, both MEASURED on 2026-09-09 rather than assumed:
 *
 *   1. The keyless surfaces are generous. npm served 250 rows in 363ms; hf/hn/openalex/
 *      swh served 200 each; twelve rapid npm calls in a burst all returned 200 with no
 *      throttling at all. Volume is not the constraint.
 *   2. `gh` search allows 30 requests per MINUTE. That is the only wall, and it is per
 *      TOKEN -- so splitting the work across parallel workers does not raise it. Ten
 *      workers share one bucket and all ten get refused. The answer is to spend the
 *      bucket deliberately, not to shard it.
 *
 * So: a token bucket for gh, a wall clock for everything, and a graceful stop that
 * reports what it skipped instead of dying or running long.
 *
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 omninbot
 */

export const GH_SEARCH_PER_MIN = 30;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Budget {
  /**
   * @param {object} opts
   * @param {number} [opts.wallMs]      total time allowed (default 15 min)
   * @param {number} [opts.ghPerMin]    gh search calls per minute
   * @param {number} [opts.now]         injectable clock, for tests
   */
  constructor(opts = {}) {
    this.wallMs = opts.wallMs ?? 15 * 60 * 1000;
    this.ghPerMin = opts.ghPerMin ?? GH_SEARCH_PER_MIN;
    this.now = opts.now ?? (() => Date.now());
    this.startedAt = this.now();
    this.ghCalls = [];
    this.skipped = [];
    this.spend = { gh: 0, http: 0 };
  }

  elapsedMs() {
    return this.now() - this.startedAt;
  }

  remainingMs() {
    return Math.max(0, this.wallMs - this.elapsedMs());
  }

  /** Has the clock run out? Callers check BETWEEN batches, never mid-flight. */
  exhausted() {
    return this.remainingMs() <= 0;
  }

  /**
   * Would starting a batch estimated at `estMs` overrun? Stopping one batch early beats
   * blowing the operator's stated budget by three minutes.
   */
  affords(estMs) {
    return this.remainingMs() > estMs;
  }

  skip(what, why) {
    this.skipped.push({ what, why, atMs: this.elapsedMs() });
  }

  noteHttp(n = 1) {
    this.spend.http += n;
  }

  /**
   * Reserve one gh search slot, waiting only as long as the wall clock allows.
   * Returns false when the budget cannot cover the wait -- caller then skips, loudly.
   */
  async takeGhSlot() {
    const windowMs = 60_000;
    for (;;) {
      const t = this.now();
      this.ghCalls = this.ghCalls.filter((ts) => t - ts < windowMs);
      if (this.ghCalls.length < this.ghPerMin) {
        this.ghCalls.push(t);
        this.spend.gh += 1;
        return true;
      }
      const oldest = this.ghCalls[0];
      const waitMs = Math.max(50, windowMs - (t - oldest) + 25);
      if (!this.affords(waitMs)) return false;
      await sleep(Math.min(waitMs, this.remainingMs()));
    }
  }

  report() {
    return {
      elapsedMs: this.elapsedMs(),
      remainingMs: this.remainingMs(),
      wallMs: this.wallMs,
      spend: { ...this.spend },
      skipped: [...this.skipped],
      exhausted: this.exhausted(),
    };
  }
}

/** "15m" / "90s" / "900000" -> ms. Bad input falls back rather than throwing mid-hunt. */
export function parseDuration(text, dflt = 15 * 60 * 1000) {
  if (text === undefined || text === null || text === '') return dflt;
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/i.exec(String(text).trim());
  if (m === null) return dflt;
  const n = Number(m[1]);
  const unit = (m[2] ?? 'ms').toLowerCase();
  const mult = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[unit];
  return Math.round(n * mult);
}

export function fmtDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}
