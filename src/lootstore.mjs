/**
 * The loot ledger — structured, labelled, queryable.
 *
 * This is where a thousand-candidate haul LIVES, so that the terminal never has to show
 * it and no context window ever has to hold it. The scan writes here; the operator reads
 * a two-page synthesis. Next hunt queries this instead of re-scanning.
 *
 * Records go through the apex-memory custody gate. A harvested candidate is
 * `sourceKind: 'verified-command'` claiming `observation` -- the scan really did find
 * it (true, attributable) but nobody has judged whether it is worth taking. That is what
 * the `unseen` verdict means, and 950 of 1000 will legitimately be `unseen`.
 *
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 omninbot
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const LOOT_PROJECT = 'sauce-loot';
export const VERDICTS = new Set(['took', 'rejected', 'pending', 'unseen']);

function lootDir() {
  const home = process.env['APEX_MEMORY_HOME'] ?? path.join(os.homedir(), '.apex-memory');
  return home;
}

/** One line per record. Append-only, greppable, survives a crash mid-harvest. */
export function lootPath() {
  return path.join(lootDir(), 'loot.jsonl');
}

/**
 * @typedef {object} LootRecord
 * @property {string} donor      owner/repo, or surface:name when not GitHub-addressable
 * @property {string} verdict    took | rejected | pending | unseen
 * @property {string} hunt       the hunt that harvested it
 * @property {string[]} framings which query framings surfaced it
 * @property {string[]} surfaces which surfaces surfaced it
 * @property {string[]} tags     computed labels
 * @property {number} score
 * @property {string} url
 * @property {string} summary    one line, from the donor's own words
 * @property {string} [why]      set when a human judges it
 * @property {number} atMs
 */

export function makeRecord(candidate, hunt, extra = {}) {
  return {
    donor: candidate.name,
    verdict: extra.verdict ?? 'unseen',
    hunt,
    framings: [...(candidate.framings ?? [])],
    surfaces: [...(candidate.surfaces ?? [])],
    tags: candidate.tags ?? [],
    score: candidate.score ?? 0,
    url: [...(candidate.urls ?? [])][0] ?? candidate.url ?? '',
    summary: String((candidate.details ?? [])[0] ?? '').slice(0, 180),
    ...(extra.why === undefined ? {} : { why: extra.why }),
    atMs: extra.atMs ?? Date.now(),
  };
}

/**
 * Bulk harvest. Append-only and idempotent per (donor, hunt): re-running a hunt updates
 * rather than duplicating, and NEVER downgrades a human verdict back to `unseen`.
 */
export function harvest(records) {
  const existing = readLoot();
  const byKey = new Map(existing.map((r) => [`${r.donor}|${r.hunt}`, r]));
  let written = 0;
  let skipped = 0;
  let protectedJudgements = 0;

  const lines = [];
  for (const rec of records) {
    const key = `${rec.donor}|${rec.hunt}`;
    const prior = byKey.get(key);
    if (prior !== undefined) {
      if (prior.verdict !== 'unseen' && rec.verdict === 'unseen') {
        protectedJudgements += 1;
        skipped += 1;
        continue;
      }
      if (prior.verdict === rec.verdict && prior.score === rec.score) {
        skipped += 1;
        continue;
      }
    }
    lines.push(JSON.stringify(rec));
    byKey.set(key, rec);
    written += 1;
  }

  if (lines.length > 0) {
    fs.mkdirSync(lootDir(), { recursive: true });
    fs.appendFileSync(lootPath(), `${lines.join('\n')}\n`, 'utf8');
  }
  return { written, skipped, protectedJudgements, total: byKey.size };
}

/** Replay the log, last write wins per (donor, hunt). */
export function readLoot() {
  let text;
  try {
    text = fs.readFileSync(lootPath(), 'utf8');
  } catch {
    return [];
  }
  const byKey = new Map();
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.length === 0) continue;
    try {
      const r = JSON.parse(t);
      if (typeof r?.donor === 'string') byKey.set(`${r.donor}|${r.hunt}`, r);
    } catch {
      continue;
    }
  }
  return [...byKey.values()];
}

/**
 * Query the ledger without touching the network. This is the whole point: after one
 * hunt, "show me every unseen rust candidate from the failure-recovery framing" costs
 * zero API calls.
 */
export function queryLoot(filter = {}) {
  let rows = readLoot();
  if (filter.hunt) rows = rows.filter((r) => r.hunt === filter.hunt);
  if (filter.verdict) rows = rows.filter((r) => r.verdict === filter.verdict);
  if (filter.framing) rows = rows.filter((r) => r.framings.includes(filter.framing));
  if (filter.surface) rows = rows.filter((r) => r.surfaces.includes(filter.surface));
  if (Array.isArray(filter.tags)) {
    rows = rows.filter((r) => filter.tags.every((t) => r.tags.includes(t)));
  }
  if (filter.donor) {
    const needle = String(filter.donor).toLowerCase();
    rows = rows.filter((r) => r.donor.toLowerCase().includes(needle));
  }
  if (typeof filter.minScore === 'number') rows = rows.filter((r) => r.score >= filter.minScore);
  return rows.sort((a, b) => b.score - a.score);
}

/** Verdicts a human set. These are the ones that must survive every re-harvest. */
export function judgements() {
  return readLoot().filter((r) => r.verdict !== 'unseen');
}

export function priorVerdicts() {
  const map = new Map();
  for (const r of judgements()) map.set(r.donor.toLowerCase(), { verdict: r.verdict, why: r.why ?? '' });
  return map;
}

export function stats() {
  const rows = readLoot();
  const byVerdict = {};
  const byHunt = {};
  const tagCounts = new Map();
  for (const r of rows) {
    byVerdict[r.verdict] = (byVerdict[r.verdict] ?? 0) + 1;
    byHunt[r.hunt] = (byHunt[r.hunt] ?? 0) + 1;
    for (const t of r.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }
  return {
    total: rows.length,
    byVerdict,
    byHunt,
    topTags: [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25),
    path: lootPath(),
  };
}
