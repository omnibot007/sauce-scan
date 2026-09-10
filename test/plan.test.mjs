import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  appendProgress,
  checkComplete,
  initPlan,
  lintPlan,
  parsePlan,
  readPlan,
  renderGraph,
} from '../src/plan.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-plan-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const PLAN = `# PLAN: demo
HUNT: a hunt
WIN: prove the handoff

## Steps

- [x] 1. Parse the plan  <- donor: ORIGINAL
      verify: vitest green
      door: two-way
      needs:
- [ ] 2. Port the gate  <- donor: OthmanAdi/planning-with-files (MIT)
      verify: exits 1 while a step is open
      door: two-way
      needs: 1
- [ ] 3. Draw the DAG  <- donor: AshutoshMahala/ascii-dag (Apache-2.0)
      verify: a cycle is reported
      door: one-way
      needs: 1
`;

describe('parsePlan — markdown a human edits, a parser trusts', () => {
  it('reads steps, checkboxes, donors and dependencies', () => {
    const { steps, meta } = parsePlan(PLAN);
    expect(steps).toHaveLength(3);
    expect(steps[0].done).toBe(true);
    expect(steps[1].done).toBe(false);
    expect(steps[1].donor).toBe('OthmanAdi/planning-with-files (MIT)');
    expect(steps[1].needs).toEqual([1]);
    expect(steps[0].title).toBe('Parse the plan');
    expect(meta.win).toBe('prove the handoff');
  });

  it('survives stray prose without dying', () => {
    const { steps } = parsePlan(`${PLAN}\nsome notes a human left\n\n> and a quote\n`);
    expect(steps).toHaveLength(3);
  });

  it('accepts an upper-case X as done, because people type both', () => {
    expect(parsePlan('- [X] 1. thing').steps[0].done).toBe(true);
  });
});

describe('checkComplete — the executor does not get a vote', () => {
  it('refuses while any step is unchecked', () => {
    const gate = checkComplete(parsePlan(PLAN));
    expect(gate.complete).toBe(false);
    expect(gate.open).toEqual([2, 3]);
    expect(gate.done).toBe(1);
  });

  it('passes only when every step is checked', () => {
    const gate = checkComplete(parsePlan(PLAN.replaceAll('- [ ]', '- [x]')));
    expect(gate.complete).toBe(true);
    expect(gate.reason).toBe('every step checked');
  });

  it('an empty plan is NOT complete — nothing is not done', () => {
    expect(checkComplete({ steps: [] }).complete).toBe(false);
  });
});

describe('lintPlan — a verify that cannot fail is not a verify', () => {
  it('passes a well-formed plan', () => {
    expect(lintPlan(parsePlan(PLAN))).toEqual([]);
  });

  it('catches a step with no verify', () => {
    const bad = parsePlan('- [ ] 1. thing  <- donor: ORIGINAL\n      door: two-way\n');
    expect(lintPlan(bad).map((p) => p.kind)).toContain('no-verify');
  });

  it('catches a step naming no donor and not marked ORIGINAL', () => {
    const bad = parsePlan('- [ ] 1. thing\n      verify: x\n      door: two-way\n');
    expect(lintPlan(bad).map((p) => p.kind)).toContain('no-donor');
  });

  it('catches a dependency on a step that does not exist', () => {
    const bad = parsePlan(
      '- [ ] 1. thing  <- donor: ORIGINAL\n      verify: x\n      door: two-way\n      needs: 9\n',
    );
    expect(lintPlan(bad).map((p) => p.kind)).toContain('dangling-dep');
  });

  it('catches a dependency cycle, because a cycle means ONE step not several', () => {
    const cyclic = parsePlan(
      '- [ ] 1. a  <- donor: ORIGINAL\n      verify: x\n      door: two-way\n      needs: 2\n' +
        '- [ ] 2. b  <- donor: ORIGINAL\n      verify: x\n      door: two-way\n      needs: 1\n',
    );
    const cycle = lintPlan(cyclic).find((p) => p.kind === 'cycle');
    expect(cycle).toBeDefined();
    expect(cycle.why).toMatch(/1|2/);
  });

  /** A plan where every part came from somewhere else is a shopping list. */
  it('flags a plan with no ORIGINAL row at all', () => {
    const borrowed = parsePlan(
      '- [ ] 1. a  <- donor: x/y (MIT)\n      verify: v\n      door: two-way\n',
    );
    expect(lintPlan(borrowed).map((p) => p.kind)).toContain('no-original');
  });

  it('reports an empty plan rather than passing it', () => {
    expect(lintPlan({ steps: [] }).map((p) => p.kind)).toContain('empty');
  });
});

describe('renderGraph — see the critical path, do not read it', () => {
  it('puts independent steps in the same band and marks it parallel', () => {
    const out = renderGraph(parsePlan(PLAN));
    expect(out).toContain('band 0');
    expect(out).toContain('band 1 [P]');
  });

  /** lintPlan reports cycles; the graph must degrade, never hang. */
  it('terminates on a cyclic plan instead of recursing forever', () => {
    const cyclic = parsePlan(
      '- [ ] 1. a  <- donor: ORIGINAL\n      needs: 2\n- [ ] 2. b  <- donor: ORIGINAL\n      needs: 1\n',
    );
    expect(() => renderGraph(cyclic)).not.toThrow();
    expect(renderGraph(cyclic)).toContain('1.');
  });
});

describe('initPlan — the channel between the heads', () => {
  it('writes all three files and carries donors into findings', () => {
    const dir = path.join(tmp, 'seed');
    const r = initPlan(dir, {
      hunt: 'a hunt',
      win: 'a win',
      donors: [{ donor: 'a/b', band: 'lateral', licence: 'permissive', summary: 'does a thing', tags: ['dom:cli'] }],
    });
    expect(r.written).toEqual(['task_plan.md', 'findings.md', 'progress.md']);
    const findings = fs.readFileSync(path.join(dir, 'findings.md'), 'utf8');
    expect(findings).toContain('a/b');
    expect(findings).toContain('lateral');
    expect(findings).toContain('dom:cli');
  });

  /** The plan is the one artefact a human edited. Never clobber it. */
  it('never overwrites an existing plan', () => {
    const dir = path.join(tmp, 'keep');
    initPlan(dir, { hunt: 'h' });
    fs.writeFileSync(path.join(dir, 'task_plan.md'), 'HUMAN EDITED', 'utf8');
    const again = initPlan(dir, { hunt: 'h' });
    expect(again.written).toEqual([]);
    expect(again.skipped).toContain('task_plan.md');
    expect(fs.readFileSync(path.join(dir, 'task_plan.md'), 'utf8')).toBe('HUMAN EDITED');
  });

  it('says so honestly when the ledger gave it nothing', () => {
    const dir = path.join(tmp, 'empty');
    initPlan(dir, { hunt: 'h', donors: [] });
    expect(fs.readFileSync(path.join(dir, 'findings.md'), 'utf8')).toContain('run /omnithief first');
  });

  it('round-trips: a seeded plan parses back and gates as not-complete', () => {
    const dir = path.join(tmp, 'round');
    initPlan(dir, { hunt: 'h', win: 'w' });
    const plan = readPlan(dir);
    expect(plan).not.toBeNull();
    expect(checkComplete(plan).complete).toBe(false);
  });

  it('returns null rather than throwing when there is no plan', () => {
    expect(readPlan(path.join(tmp, 'nothing-here'))).toBeNull();
  });
});

describe('appendProgress — the file that survives being wrong', () => {
  it('appends and never rewrites', () => {
    const dir = path.join(tmp, 'prog');
    initPlan(dir, { hunt: 'h' });
    appendProgress(dir, 'first');
    appendProgress(dir, 'second');
    const body = fs.readFileSync(path.join(dir, 'progress.md'), 'utf8');
    expect(body).toContain('first');
    expect(body).toContain('second');
    expect(body.indexOf('first')).toBeLessThan(body.indexOf('second'));
  });
});
