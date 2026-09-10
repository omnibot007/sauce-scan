#!/usr/bin/env node
/**
 * The anti-cap check. Run it whenever you doubt the king.
 *
 * Every "Measured: N" in the skills and source is a claim about a corpus that keeps
 * growing. Three of them were already wrong when this script was written:
 *
 *   "455 candidates across 3 framings"   -> no such run existed; the real 3-framing
 *                                           raid harvested 306
 *   "ckeditor5 via `process supervision   -> that framing never ran. ckeditor arrived
 *    restart watchdog`"                     through `salvage yard part harvest refit`
 *   "taskplane scored 18"                -> zero taskplane rows in the ledger
 *
 * And two more rotted DURING the session that fixed them, because the ledger grew from
 * 11,711 to 12,017 rows between measuring and writing it down.
 *
 * So: absolute counts of a growing corpus are not claims, they are timestamps. Claims
 * that must survive are RATIOS. This script checks both kinds and exits non-zero on drift.
 *
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 omninbot
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const LOOT = path.join(os.homedir(), '.apex-memory', 'loot.jsonl');

function loadRows() {
  if (!fs.existsSync(LOOT)) return [];
  return fs
    .readFileSync(LOOT, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
}

const rows = loadRows();
if (rows.length === 0) {
  process.stdout.write('verify-claims: no loot ledger on this machine — nothing to check\n');
  process.exit(0);
}

const huntStats = new Map();
for (const r of rows) {
  const s = huntStats.get(r.hunt) ?? { n: 0, framings: new Set() };
  s.n += 1;
  for (const f of r.framings ?? []) s.framings.add(f);
  huntStats.set(r.hunt, s);
}
const hunt = (name) => huntStats.get(name) ?? { n: 0, framings: new Set() };
const donor = (name) => rows.find((r) => r.donor === name);

const framingHaul = (huntName) => {
  const counts = new Map();
  for (const r of rows.filter((x) => x.hunt === huntName)) {
    for (const f of r.framings ?? []) counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
};

const PLANNER = 'a planner that turns harvested prior art into an ordered verifiable execution plan';
const search = framingHaul('methods of searching');
const multiSurface = rows.filter((r) => (r.surfaces ?? []).length > 1).length;

/**
 * `stable` claims must hold forever. `drifts` are absolute counts of a growing corpus --
 * reported, but a mismatch there is staleness, not dishonesty.
 */
const CLAIMS = [
  { kind: 'stable', label: 'planner raid rows', actual: hunt(PLANNER).n, want: 2072 },
  { kind: 'stable', label: 'planner raid framings', actual: hunt(PLANNER).framings.size, want: 13 },
  { kind: 'stable', label: 'harness raid rows', actual: hunt('coding agent harness architecture').n, want: 5248 },
  { kind: 'stable', label: 'harness raid framings', actual: hunt('coding agent harness architecture').framings.size, want: 28 },
  { kind: 'stable', label: 'literal framing top haul', actual: search[0]?.[1], want: 307 },
  { kind: 'stable', label: 'next-best framing haul', actual: search[1]?.[1], want: 244 },
  { kind: 'stable', label: 'literal framing IS the top', actual: search[0]?.[0], want: 'methods of searching' },
  { kind: 'stable', label: 'ascii-dag score', actual: donor('AshutoshMahala/ascii-dag')?.score, want: 33 },
  { kind: 'stable', label: 'planning-with-files score', actual: donor('OthmanAdi/planning-with-files')?.score, want: 27 },
  {
    kind: 'stable',
    label: 'ckeditor arrived via salvage-yard framing',
    actual: rows.some(
      (r) => String(r.donor).includes('ckeditor') && (r.framings ?? []).includes('salvage yard part harvest refit'),
    ),
    want: true,
  },
  {
    kind: 'stable',
    label: 'preregistration framing rows',
    actual: rows.filter((r) => (r.framings ?? []).some((f) => f.includes('preregistration'))).length,
    want: 92,
  },
  {
    kind: 'stable',
    label: 'cross-surface rows stay under 1%',
    actual: (multiSurface / rows.length) * 100 < 1,
    want: true,
  },
  { kind: 'drift', label: 'total ledger rows', actual: rows.length, want: 12017 },
  { kind: 'drift', label: 'rows with 2+ surfaces', actual: multiSurface, want: 35 },
];

let failed = 0;
let drifted = 0;
const out = ['ANTI-CAP CHECK — every documented number, against the live ledger', ''];

for (const c of CLAIMS) {
  const ok = String(c.actual) === String(c.want);
  if (!ok && c.kind === 'stable') failed += 1;
  if (!ok && c.kind === 'drift') drifted += 1;
  const mark = ok ? 'OK  ' : c.kind === 'drift' ? 'DRIFT' : 'CAP ';
  out.push(`  ${mark} ${c.label.padEnd(42)} claimed=${c.want} actual=${c.actual}`);
}

out.push('');
out.push(`  cross-surface ratio: ${multiSurface}/${rows.length} = ${((multiSurface / rows.length) * 100).toFixed(2)}%`);
out.push('');
if (failed > 0) out.push(`FAILED: ${failed} claim(s) the king cannot back up.`);
else out.push('CLEAN: every stable claim is backed by the ledger.');
if (drifted > 0) {
  out.push(
    `${drifted} absolute count(s) drifted — the corpus grew. That is staleness, not cap;`,
  );
  out.push('quote the RATIO in documentation, not the row count.');
}

process.stdout.write(`${out.join('\n')}\n`);
process.exit(failed > 0 ? 1 : 0);
