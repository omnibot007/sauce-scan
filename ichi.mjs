#!/usr/bin/env node
/**
 * /ichi — the middle head, as a real command.
 *
 * The plan used to be prose in a skill file. Now it is an artefact three commands can
 * seed, check and draw, which is what lets the heads hand work to each other instead of
 * describing a handoff to a model and hoping.
 *
 *   ichi --init  <dir> --hunt "<hunt>" [--win "<one line>"] [--top 12]
 *        seed task_plan.md / findings.md / progress.md, with findings PRE-FILLED from
 *        the loot ledger. This is the channel: the left head's haul is already there.
 *
 *   ichi --check <dir>
 *        lint the plan and run the completion gate. Exit 1 when the plan is unfinished
 *        or malformed, so a build script cannot claim done over the top of it.
 *
 *   ichi --graph <dir>
 *        the dependency DAG in bands, parallel work marked [P].
 *
 *   ichi --log   <dir> "<line>"
 *        append one line to progress.md.
 *
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 omninbot
 */
import path from 'node:path';
import process from 'node:process';

import { lintFraming } from './src/framing.mjs';
import { queryLoot } from './src/lootstore.mjs';
import { synthesize } from './src/synth.mjs';
import {
  appendProgress,
  checkComplete,
  initPlan,
  lintPlan,
  readPlan,
  renderGraph,
} from './src/plan.mjs';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

const USAGE = `ichi — the middle head

  ichi --init  <dir> --hunt "<hunt>" [--win "<line>"] [--top 12]
  ichi --check <dir>
  ichi --graph <dir>
  ichi --log   <dir> "<line>"

The plan is the handoff. /omnithief fills the ledger, ichi turns it into an ordered
plan on disk, /omnibuilder executes it and cannot declare done over an open step.`;

/**
 * Pull the best ledger rows for a hunt so findings.md starts from evidence.
 *
 * Ordered by the SYNTHESIS, never by raw score. Measured, and this exact function shipped
 * the bug first: sorting by score fed the planner `slackapi/node-slack-sdk`,
 * `react-component/steps` and `vercel/vercel` as its top three donors -- because `score`
 * carries a `log10(stars) * 4` popularity term, so it ranks fame, not fit. The two donors
 * actually taken from that raid, ascii-dag and planning-with-files, sat 68th and lower.
 *
 * So the channel carries what the synthesis already vetted, in the order the skill tells
 * you to read it: cross-surface agreement first, then the lateral finds that came through
 * a door nothing else opened, then broad matches, then the permissive-and-alive shortlist.
 */
/**
 * RETROACTIVE LEDGER HYGIENE. The linter learns faster than the vault forgets.
 *
 * A raid run before the linter knew a word was colonised leaves that junk in the ledger
 * permanently, and nothing marks it. Measured: the planner raid included `critical path
 * slack estimate schedule`, which returned `slackapi/node-slack-sdk` as its top-ranked
 * hit -- and that row then led the plan's donor list, because the ledger has no memory of
 * WHY a framing was bad.
 *
 * So every stored row is re-linted against TODAY's rules using the framings recorded
 * beside it. A row that only ever arrived through framings the linter would now reject is
 * skipped. A row that also arrived through a good framing is kept, because the framing was
 * bad, not the project.
 */
function onlyFromBadFramings(r) {
  const framings = r.framings ?? [];
  if (framings.length === 0) return false;
  return framings.every((f) => lintFraming(f).some((p) => p.severity === 'high'));
}

function donorsFor(hunt, top) {
  let rows = [];
  try {
    rows = queryLoot({ hunt, top: 5000 });
  } catch {
    return [];
  }

  const s = synthesize(rows, { limit: 15, takeLimit: 40 });
  const licenceOf = (r) => {
    const tag = (r.tags ?? []).find((t) => t.startsWith('lic:'));
    return tag === undefined ? null : tag.slice(4);
  };

  const seen = new Set();
  const picked = [];
  const bands = [
    ['convergent', s.convergent],
    ['lateral', s.laterals],
    ['broad-match', s.broadMatch],
    ['takeable', s.takeables],
  ];

  for (const [band, list] of bands) {
    for (const r of list ?? []) {
      if (seen.has(r.donor) || r.verdict === 'rejected') continue;
      if (onlyFromBadFramings(r)) continue;
      seen.add(r.donor);
      picked.push({
        donor: r.donor,
        band,
        licence: licenceOf(r),
        summary: r.summary,
        tags: (r.tags ?? []).filter((t) => /^(dom|lic|age|use|has):/.test(t)),
      });
      if (picked.length >= (Number(top) || 12)) return picked;
    }
  }
  return picked;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = path.resolve(
    typeof args.init === 'string'
      ? args.init
      : typeof args.check === 'string'
        ? args.check
        : typeof args.graph === 'string'
          ? args.graph
          : typeof args.log === 'string'
            ? args.log
            : (args._[0] ?? '.'),
  );

  if (args.init !== undefined) {
    const hunt = typeof args.hunt === 'string' ? args.hunt : '';
    const donors = hunt === '' ? [] : donorsFor(hunt, args.top);
    const r = initPlan(dir, {
      hunt,
      win: typeof args.win === 'string' ? args.win : '',
      donors,
    });
    process.stdout.write(
      `ichi: seeded ${r.dir}\n` +
        `  written: ${r.written.join(', ') || 'nothing'}\n` +
        (r.skipped.length > 0 ? `  kept (already existed): ${r.skipped.join(', ')}\n` : '') +
        `  donors pre-filled from ledger: ${donors.length}\n` +
        (donors.length === 0 && hunt !== ''
          ? '  (no ledger rows carried a mechanism tag for that hunt — run /omnithief first)\n'
          : ''),
    );
    return 0;
  }

  if (args.graph !== undefined) {
    const plan = readPlan(dir);
    if (plan === null) {
      process.stdout.write(`ichi: no task_plan.md in ${dir}\n`);
      return 1;
    }
    process.stdout.write(`THE GRAPH — ${plan.steps.length} steps\n${renderGraph(plan)}\n`);
    return 0;
  }

  if (args.log !== undefined) {
    const line = args._.join(' ').trim();
    if (line === '') {
      process.stdout.write('ichi: --log needs a line to append\n');
      return 1;
    }
    process.stdout.write(`ichi: appended to ${appendProgress(dir, line)}\n`);
    return 0;
  }

  if (args.check !== undefined) {
    const plan = readPlan(dir);
    if (plan === null) {
      process.stdout.write(`ichi: no task_plan.md in ${dir}\n`);
      return 1;
    }
    const problems = lintPlan(plan);
    const gate = checkComplete(plan);

    const out = [`ichi: ${dir}`, `  steps ${gate.done}/${gate.total} done`];
    if (problems.length > 0) {
      out.push('', 'PLAN LINT');
      for (const p of problems) {
        out.push(`  ! ${p.kind}: ${p.why}`);
        if (p.fix !== undefined) out.push(`      -> ${p.fix}`);
      }
    } else {
      out.push('  plan lint: clean');
    }
    out.push('', `GATE: ${gate.complete ? 'COMPLETE' : 'NOT COMPLETE'} — ${gate.reason}`);
    process.stdout.write(`${out.join('\n')}\n`);

    // Exit non-zero so a build script cannot claim done over an open or broken plan.
    return gate.complete && problems.length === 0 ? 0 : 1;
  }

  process.stdout.write(`${USAGE}\n`);
  return 0;
}

process.exit(main());
