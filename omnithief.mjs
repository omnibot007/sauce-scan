#!/usr/bin/env node
/**
 * omnithief — the all-out hunt.
 *
 * Scans wide across many framings, labels everything deterministically, writes the whole
 * haul to the loot ledger, and returns TWO PAGES.
 *
 * The architecture exists to solve one problem: a thousand candidates is unreadable and
 * would cost ~100k tokens of context to hold. So the haul never reaches the terminal.
 * It goes to the ledger, labelled and queryable, and the operator reads a synthesis.
 * Memory is the answer to context.
 *
 *   omnithief "<hunt>" --framings "a" --framings "b" ... [--budget 15m] [--limit 60]
 *   omnithief --ledger --tags eco:rust,dom:recovery      # query, zero network
 *   omnithief --stats
 *
 * The FRAMINGS are the intelligence. Volume alone is noise; volume across genuinely
 * different framings -- the mechanism, the category, the failure it prevents, the
 * adjacent domain that solved this decades ago -- is where the unexpected steal lives.
 *
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 omninbot
 */
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { Budget, fmtDuration, parseDuration } from './src/budget.mjs';
import { renderLint } from './src/framing.mjs';
import { labelCandidate } from './src/labels.mjs';
import { harvest, makeRecord, priorVerdicts, queryLoot, recordVerdict, stats } from './src/lootstore.mjs';
import { renderSynthesis, synthesize } from './src/synth.mjs';

const run = promisify(execFile);
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const SCANNER = path.join(HERE, 'sauce-scan.mjs');

function argAll(name) {
  const out = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === `--${name}` && process.argv[i + 1] !== undefined) out.push(process.argv[i + 1]);
  }
  return out;
}
const arg = (name, dflt) => argAll(name)[0] ?? dflt;
const has = (name) => process.argv.includes(`--${name}`);

async function scanOnce(framing, limit, budget) {
  budget.noteHttp();
  const { stdout } = await run(
    process.execPath,
    [SCANNER, framing, '--limit', String(limit), '--narrow', '--json'],
    { timeout: Math.max(30_000, budget.remainingMs()), maxBuffer: 128 * 1024 * 1024, windowsHide: true },
  );
  return JSON.parse(stdout).candidates ?? [];
}

/** Merge candidates across framings, remembering WHICH framing opened each door. */
function mergeByDonor(all) {
  const byKey = new Map();
  for (const { framing, cands } of all) {
    for (const c of cands) {
      const key = c.name;
      const prev = byKey.get(key);
      if (prev === undefined) {
        byKey.set(key, {
          ...c,
          surfaces: new Set(c.surfaces ?? []),
          urls: new Set(c.urls ?? []),
          framings: new Set([framing]),
          details: [...(c.details ?? [])],
        });
        continue;
      }
      for (const s of c.surfaces ?? []) prev.surfaces.add(s);
      for (const u of c.urls ?? []) prev.urls.add(u);
      prev.framings.add(framing);
      for (const d of c.details ?? []) if (!prev.details.includes(d)) prev.details.push(d);
      prev.score = Math.max(prev.score ?? 0, c.score ?? 0);
      prev.downloads = Math.max(prev.downloads ?? 0, c.downloads ?? 0);
      if (!prev.license && c.license) prev.license = c.license;
      if (c.updated && c.updated > (prev.updated ?? '')) prev.updated = c.updated;
      prev.relevance = Math.max(prev.relevance ?? 0, c.relevance ?? 0);
    }
  }
  return [...byKey.values()].map((c) => ({
    ...c,
    surfaces: [...c.surfaces],
    urls: [...c.urls],
    framings: [...c.framings],
  }));
}

async function main() {
  if (has('remember')) {
    const donor = arg('remember', '');
    const verdict = arg('verdict', 'pending');
    const why = arg('why', '');
    if (!donor) {
      process.stderr.write('--remember <donor> --verdict took|rejected|pending --why "<reason>"\n');
      process.exit(1);
    }
    const r = recordVerdict(donor, verdict, why);
    process.stdout.write(`recorded: ${r.donor}: ${r.verdict} — ${r.why}\n`);
    return;
  }

  if (has('stats')) {
    const s = stats();
    process.stdout.write(
      [
        `LOOT LEDGER  ${s.path}`,
        `  total ${s.total}`,
        `  by verdict: ${Object.entries(s.byVerdict).map(([k, v]) => `${k}=${v}`).join('  ')}`,
        `  by hunt: ${Object.entries(s.byHunt).map(([k, v]) => `${k}=${v}`).join('  ') || '(none)'}`,
        `  top tags: ${s.topTags.map(([t, n]) => `${t}(${n})`).join(' ')}`,
      ].join('\n') + '\n',
    );
    return;
  }

  if (has('ledger')) {
    const tags = String(arg('tags', '')).split(',').filter(Boolean);
    const rows = queryLoot({
      ...(tags.length > 0 ? { tags } : {}),
      ...(arg('hunt') ? { hunt: arg('hunt') } : {}),
      ...(arg('verdict') ? { verdict: arg('verdict') } : {}),
      ...(arg('framing') ? { framing: arg('framing') } : {}),
    });
    process.stdout.write(
      `${rows.length} rows (zero network)\n` +
        rows.slice(0, Number(arg('top', 40))).map((r) =>
          `  ${String(r.score).padStart(4)}  [${r.verdict}] ${r.donor}\n        ${r.summary.slice(0, 110)}\n        ${r.tags.join(' ')}`,
        ).join('\n') + '\n',
    );
    return;
  }

  const flagIdx = process.argv.findIndex((a, i) => i > 1 && a.startsWith('--'));
  const hunt = (flagIdx === -1 ? process.argv.slice(2) : process.argv.slice(2, flagIdx)).join(' ').trim();

  if (hunt.length === 0 || has('help')) {
    process.stdout.write(
      [
        'omnithief "<hunt>" [--framings "<take>"]... [--budget 15m] [--limit 60]',
        'omnithief --ledger [--tags a,b] [--hunt h] [--verdict unseen] [--framing f]',
        'omnithief --stats',
        '',
        'The FRAMINGS are the intelligence. Pass several genuinely different takes:',
        '  the mechanism · the category · the failure it prevents · the ADJACENT DOMAIN',
        'Supervision trees, circuit breakers and watchdogs solved agent supervision',
        'decades before agents existed. That framing is where the unexpected steal is.',
        '',
        'The haul goes to the loot ledger, not to your terminal. Query it with --ledger.',
      ].join('\n') + '\n',
    );
    return;
  }

  const budget = new Budget({ wallMs: parseDuration(arg('budget', '15m')) });
  const limit = Number(arg('limit', 60)) || 60;
  const framings = [...new Set([hunt, ...argAll('framings')])];

  process.stderr.write(`omnithief: ${framings.length} framings, budget ${fmtDuration(budget.wallMs)}\n`);

  // Lint BEFORE spending the budget. Wording is the single biggest determinant of what a
  // raid finds -- bigger than surfaces, limits or time. A warned framing still runs
  // (a noisy hit beats a missed one) but the operator gets told what it will cost.
  const lint = renderLint(framings);
  if (lint) process.stderr.write(`${lint}\n\n`);
  if (has('lint-only')) {
    process.stdout.write(lint || 'FRAMING LINT: clean\n');
    return;
  }

  const results = [];
  for (const framing of framings) {
    if (!budget.affords(20_000)) {
      budget.skip(framing, 'wall clock');
      continue;
    }
    const t0 = Date.now();
    try {
      const cands = await scanOnce(framing, limit, budget);
      results.push({ framing, cands });
      process.stderr.write(`  [${fmtDuration(budget.elapsedMs())}] ${framing} -> ${cands.length}\n`);
    } catch (e) {
      budget.skip(framing, String(e.message).slice(0, 60));
      process.stderr.write(`  [${fmtDuration(budget.elapsedMs())}] ${framing} -> FAILED\n`);
    }
    if (Date.now() - t0 > budget.remainingMs()) break;
  }

  const merged = mergeByDonor(results);
  const priors = priorVerdicts();
  const rows = merged.map((c) => {
    const tags = labelCandidate(c, { totalFramings: framings.length });
    const prior = priors.get(String(c.name).toLowerCase());
    return makeRecord({ ...c, tags }, hunt, prior === undefined ? {} : { verdict: prior.verdict, why: prior.why });
  });

  const h = harvest(rows);
  const b = budget.report();

  process.stdout.write(`${renderSynthesis(synthesize(rows), hunt)}\n`);
  process.stdout.write(
    [
      '\n## LEDGER',
      `  harvested ${h.written} new, ${h.skipped} already known, ${h.protectedJudgements} human verdicts protected`,
      `  ledger now holds ${h.total} records — query with: omnithief --ledger --tags <tag>`,
      '\n## BUDGET',
      `  ${fmtDuration(b.elapsedMs)} of ${fmtDuration(b.wallMs)} · ${b.spend.http} scans`,
      b.skipped.length > 0 ? `  SKIPPED: ${b.skipped.map((s) => `${s.what}(${s.why})`).join(', ')}` : '  nothing skipped',
    ].join('\n') + '\n',
  );
}

main().catch((e) => {
  process.stderr.write(`omnithief failed: ${e?.message ?? String(e)}\n`);
  process.exit(1);
});
