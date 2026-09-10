/**
 * The channel between the heads.
 *
 * /omnithief writes a loot ledger. /ichi writes a plan. /omnibuilder reads the plan.
 * Before this file existed that handoff was PROSE -- the skill told a model to "write
 * task_plan.md" and nothing created it, parsed it, or refused a false done-claim. A
 * handoff nothing validates is not a handoff, it is an intention.
 *
 * So the plan is a real artefact with a real parser:
 *
 *   initPlan()      seeds the three files FROM THE LEDGER, so the middle head starts
 *                   with what the left head actually found instead of a blank page
 *   parsePlan()     reads the markdown back into steps
 *   lintPlan()      refuses a plan missing verifies, donors, or with a dependency cycle
 *   checkComplete() the gate: unchecked steps mean NOT done, and the executor gets no vote
 *   renderGraph()   the dependency DAG as text, so the critical path is seen not read
 *
 * The format is markdown a human reads and a parser trusts. Both halves matter: a plan
 * only a machine can read stops being maintained, and a plan only a human can read
 * cannot gate anything.
 *
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 omninbot
 */
import fs from 'node:fs';
import path from 'node:path';

export const PLAN_FILE = 'task_plan.md';
export const FINDINGS_FILE = 'findings.md';
export const PROGRESS_FILE = 'progress.md';

/** `- [ ] 3. Port the gate  <- donor: owner/repo (MIT)` */
const STEP_RE = /^-\s*\[( |x|X)\]\s*(\d+)\.\s*(.+?)\s*$/;
const FIELD_RE = /^\s{2,}(verify|door|needs|donor):\s*(.*)$/i;

/**
 * Parse a plan into steps. Tolerant of trailing prose and blank lines -- a plan is a
 * document people edit by hand, and a parser that dies on a stray line is a parser
 * nobody keeps using.
 */
export function parsePlan(text) {
  const steps = [];
  const meta = {};
  let current = null;

  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\r$/, '');

    const head = STEP_RE.exec(line);
    if (head !== null) {
      const [, mark, num, title] = head;
      const donorInline = /<-\s*donor:\s*(.+?)\s*$/i.exec(title);
      current = {
        n: Number(num),
        done: mark.toLowerCase() === 'x',
        title: donorInline === null ? title : title.slice(0, donorInline.index).trim(),
        donor: donorInline === null ? null : donorInline[1],
        verify: null,
        door: null,
        needs: [],
      };
      steps.push(current);
      continue;
    }

    const field = FIELD_RE.exec(line);
    if (field !== null && current !== null) {
      const key = field[1].toLowerCase();
      const value = field[2].trim();
      if (key === 'needs') {
        current.needs = value
          .split(/[,\s]+/)
          .map((v) => Number(v))
          .filter((v) => Number.isInteger(v) && v > 0);
      } else {
        current[key] = value.length === 0 ? null : value;
      }
      continue;
    }

    const kv = /^([A-Z][A-Z ]+):\s*(.+)$/.exec(line);
    if (kv !== null && current === null) meta[kv[1].trim().toLowerCase()] = kv[2].trim();
  }

  return { meta, steps };
}

/**
 * Refuse a plan that cannot be executed or verified. Returns problems, never throws.
 *
 * The `verify` requirement is the load-bearing one: a step whose verify is a feeling
 * cannot gate anything, and a plan full of those looks finished while proving nothing.
 */
export function lintPlan({ steps }) {
  const problems = [];
  if (steps.length === 0) {
    problems.push({ kind: 'empty', why: 'no steps found — a plan with no steps is a note' });
    return problems;
  }

  const byNumber = new Map(steps.map((s) => [s.n, s]));

  for (const s of steps) {
    if (s.verify === null) {
      problems.push({
        kind: 'no-verify',
        step: s.n,
        why: `step ${s.n} has no verify — nothing can prove it happened`,
        fix: 'add a command or a readable artefact, never "looks good"',
      });
    }
    if (s.donor === null) {
      problems.push({
        kind: 'no-donor',
        step: s.n,
        why: `step ${s.n} names no donor and is not marked ORIGINAL`,
        fix: 'cite the repo it came from, or write ORIGINAL and say why nobody had it',
      });
    }
    if (s.door === null) {
      problems.push({
        kind: 'no-door',
        step: s.n,
        why: `step ${s.n} does not say one-way or two-way`,
        fix: 'one-way doors get deferred as late as dependency order allows',
      });
    }
    for (const need of s.needs) {
      if (!byNumber.has(need)) {
        problems.push({
          kind: 'dangling-dep',
          step: s.n,
          why: `step ${s.n} needs step ${need}, which does not exist`,
        });
      }
    }
  }

  for (const cycle of findCycles(steps)) {
    problems.push({
      kind: 'cycle',
      why: `dependency cycle: ${cycle.join(' -> ')}`,
      fix: 'a cycle means these are ONE step, not several. Merge them and say so',
    });
  }

  if (!steps.some((s) => /ORIGINAL/i.test(s.donor ?? ''))) {
    problems.push({
      kind: 'no-original',
      why: 'no step is marked ORIGINAL — every part came from somewhere else',
      fix: 'that is a shopping list, not a build. Say so, and recommend installing the donor',
    });
  }

  return problems;
}

/** Depth-first cycle hunt. A cycle in a plan is a bug in the plan. */
function findCycles(steps) {
  const graph = new Map(steps.map((s) => [s.n, s.needs]));
  const cycles = [];
  const state = new Map();

  const walk = (node, trail) => {
    if (state.get(node) === 'done') return;
    if (state.get(node) === 'open') {
      const start = trail.indexOf(node);
      if (start !== -1) cycles.push([...trail.slice(start), node]);
      return;
    }
    state.set(node, 'open');
    for (const next of graph.get(node) ?? []) {
      if (graph.has(next)) walk(next, [...trail, node]);
    }
    state.set(node, 'done');
  };

  for (const s of steps) walk(s.n, []);
  return cycles;
}

/**
 * THE GATE. The plan defines done; the executor does not get a vote.
 *
 * Mechanism borrowed from `OthmanAdi/planning-with-files` (MIT) -- `check-complete` /
 * `gate-stop` refuse a done-claim while any step is unchecked. Reimplemented here, no
 * code copied.
 */
export function checkComplete({ steps }) {
  const open = steps.filter((s) => !s.done);
  return {
    complete: steps.length > 0 && open.length === 0,
    total: steps.length,
    done: steps.length - open.length,
    open: open.map((s) => s.n),
    reason:
      steps.length === 0
        ? 'no steps'
        : open.length === 0
          ? 'every step checked'
          : `${open.length} step(s) still open: ${open.map((s) => s.n).join(', ')}`,
  };
}

/**
 * Topological order plus the parallel bands. Steps in the same band have no dependency
 * on each other and can run together.
 *
 * Idea from `AshutoshMahala/ascii-dag` (Apache-2.0) -- render a DAG to text so the
 * critical path is seen rather than read. Written clean-room, no code copied.
 */
export function renderGraph({ steps }) {
  const byNumber = new Map(steps.map((s) => [s.n, s]));
  const depth = new Map();

  const depthOf = (n, seen = new Set()) => {
    if (depth.has(n)) return depth.get(n);
    if (seen.has(n)) return 0; // cycle: lintPlan reports it, the graph must not hang
    seen.add(n);
    const step = byNumber.get(n);
    const needs = (step?.needs ?? []).filter((d) => byNumber.has(d));
    const d = needs.length === 0 ? 0 : 1 + Math.max(...needs.map((x) => depthOf(x, seen)));
    depth.set(n, d);
    return d;
  };

  for (const s of steps) depthOf(s.n);

  const bands = new Map();
  for (const s of steps) {
    const d = depth.get(s.n) ?? 0;
    bands.set(d, [...(bands.get(d) ?? []), s]);
  }

  const lines = [];
  for (const d of [...bands.keys()].sort((a, b) => a - b)) {
    const band = bands.get(d).sort((a, b) => a.n - b.n);
    const tag = band.length > 1 ? ' [P]' : '';
    lines.push(`  band ${d}${tag}`);
    for (const s of band) {
      const mark = s.done ? 'x' : ' ';
      const needs = s.needs.length > 0 ? `  (needs ${s.needs.join(',')})` : '';
      lines.push(`    [${mark}] ${s.n}. ${s.title.slice(0, 62)}${needs}`);
    }
  }
  return lines.join('\n');
}

/**
 * Seed the three files FROM THE LEDGER. This is the actual channel between the heads:
 * the middle head opens findings.md and the left head's haul is already in it.
 *
 * Never overwrites an existing plan -- a plan is the one artefact in this system that a
 * human has edited, and clobbering it would destroy the only non-reproducible thing here.
 */
export function initPlan(dir, { hunt = '', win = '', donors = [] } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const written = [];
  const skipped = [];

  const write = (name, body) => {
    const full = path.join(dir, name);
    if (fs.existsSync(full)) {
      skipped.push(name);
      return;
    }
    fs.writeFileSync(full, body, 'utf8');
    written.push(name);
  };

  const donorLines =
    donors.length === 0
      ? '  (no ledger rows matched — run /omnithief first, or plan from scratch)'
      : donors
          .map(
            (d) =>
              `- **${d.donor}**  \`${d.band ?? 'ledger'}\`  — ${d.licence ?? 'licence UNKNOWN'}\n  ${String(d.summary ?? '').slice(0, 120)}\n  tags: ${(d.tags ?? []).join(' ')}`,
          )
          .join('\n');

  write(
    PLAN_FILE,
    `# PLAN: ${win || hunt || 'untitled'}
HUNT: ${hunt}
WIN: ${win}

## Steps

Each step needs a donor (or ORIGINAL), a verify that would FAIL if the step were
skipped, and a door. \`needs:\` lists the step numbers this one depends on.

- [ ] 1. <the first thing>  <- donor: ORIGINAL
      verify: <a command, or an artefact you can read back>
      door: two-way
      needs:
`,
  );

  write(
    FINDINGS_FILE,
    `# FINDINGS: ${hunt}

What the raid found, and what it means. This file is seeded from the loot ledger so the
plan starts from evidence rather than a blank page.

## Donors on the table

${donorLines}
`,
  );

  write(
    PROGRESS_FILE,
    `# PROGRESS: ${hunt}

Append-only. Never rewrite a line here — this is the file that survives being wrong.

`,
  );

  return { dir, written, skipped };
}

/** Append one line to progress.md. Append-only by construction. */
export function appendProgress(dir, line) {
  const full = path.join(dir, PROGRESS_FILE);
  fs.appendFileSync(full, `- ${new Date().toISOString()} ${line}\n`, 'utf8');
  return full;
}

/** Read a plan off disk. Returns null when there is no plan, never throws. */
export function readPlan(dir) {
  const full = path.join(dir, PLAN_FILE);
  if (!fs.existsSync(full)) return null;
  return parsePlan(fs.readFileSync(full, 'utf8'));
}
