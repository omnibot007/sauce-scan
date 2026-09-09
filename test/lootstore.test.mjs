import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { harvest, judgements, makeRecord, priorVerdicts, queryLoot, readLoot, stats } from '../src/lootstore.mjs';

let sandbox;
const original = process.env['APEX_MEMORY_HOME'];

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'loot-test-'));
  process.env['APEX_MEMORY_HOME'] = sandbox;
});

afterEach(() => {
  if (original === undefined) delete process.env['APEX_MEMORY_HOME'];
  else process.env['APEX_MEMORY_HOME'] = original;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function cand(name, over = {}) {
  return {
    name,
    surfaces: new Set(['npm']),
    framings: new Set(['f1']),
    tags: ['lic:permissive'],
    score: 10,
    urls: new Set([`https://github.com/${name}`]),
    details: ['does a thing'],
    ...over,
  };
}

describe('harvest', () => {
  it('writes records and reads them back', () => {
    const r = harvest([makeRecord(cand('a/b'), 'hunt1'), makeRecord(cand('c/d'), 'hunt1')]);
    expect(r.written).toBe(2);
    const rows = readLoot();
    expect(rows).toHaveLength(2);
    expect(rows[0].verdict).toBe('unseen');
    expect(rows[0].hunt).toBe('hunt1');
  });

  it('is idempotent — re-harvesting the same hunt writes nothing new', () => {
    const recs = [makeRecord(cand('a/b'), 'hunt1')];
    harvest(recs);
    const second = harvest(recs);
    expect(second.written).toBe(0);
    expect(second.skipped).toBe(1);
    expect(readLoot()).toHaveLength(1);
  });

  it('NEVER downgrades a human verdict back to unseen', () => {
    harvest([makeRecord(cand('a/b'), 'hunt1')]);
    harvest([makeRecord(cand('a/b'), 'hunt1', { verdict: 'rejected', why: 'needs neo4j' })]);
    expect(readLoot()[0].verdict).toBe('rejected');

    // A later re-scan tries to write it back as unseen. It must be refused.
    const again = harvest([makeRecord(cand('a/b'), 'hunt1')]);
    expect(again.protectedJudgements).toBe(1);
    const row = readLoot()[0];
    expect(row.verdict).toBe('rejected');
    expect(row.why).toBe('needs neo4j');
  });

  it('keeps the same donor separate across different hunts', () => {
    harvest([makeRecord(cand('a/b'), 'hunt1'), makeRecord(cand('a/b'), 'hunt2')]);
    expect(readLoot()).toHaveLength(2);
  });

  it('survives junk lines in the log', () => {
    harvest([makeRecord(cand('a/b'), 'hunt1')]);
    fs.appendFileSync(path.join(sandbox, 'loot.jsonl'), 'not json\n', 'utf8');
    expect(readLoot()).toHaveLength(1);
  });
});

describe('queryLoot — zero network', () => {
  beforeEach(() => {
    harvest([
      makeRecord(cand('rust/one', { tags: ['eco:rust', 'dom:recovery'], score: 30 }), 'h'),
      makeRecord(cand('js/two', { tags: ['eco:js', 'dom:recovery'], score: 20 }), 'h'),
      makeRecord(cand('rust/three', { tags: ['eco:rust'], framings: new Set(['adjacent']), score: 10 }), 'h'),
      makeRecord(cand('old/four', { score: 5 }), 'other-hunt'),
    ]);
  });

  it('filters by tags, and requires ALL of them', () => {
    expect(queryLoot({ tags: ['eco:rust'] }).map((r) => r.donor)).toEqual(['rust/one', 'rust/three']);
    expect(queryLoot({ tags: ['eco:rust', 'dom:recovery'] }).map((r) => r.donor)).toEqual(['rust/one']);
  });

  it('filters by hunt, framing and verdict', () => {
    expect(queryLoot({ hunt: 'other-hunt' })).toHaveLength(1);
    expect(queryLoot({ framing: 'adjacent' }).map((r) => r.donor)).toEqual(['rust/three']);
    expect(queryLoot({ verdict: 'unseen' })).toHaveLength(4);
  });

  it('sorts by score descending and honours minScore', () => {
    expect(queryLoot({}).map((r) => r.score)).toEqual([30, 20, 10, 5]);
    expect(queryLoot({ minScore: 15 })).toHaveLength(2);
  });
});

describe('judgements and stats', () => {
  it('separates judged from unseen', () => {
    harvest([
      makeRecord(cand('a/b'), 'h'),
      makeRecord(cand('c/d'), 'h', { verdict: 'took', why: 'checkpoint discipline' }),
    ]);
    expect(judgements()).toHaveLength(1);
    expect(priorVerdicts().get('c/d').verdict).toBe('took');
  });

  it('reports totals without loading the haul into anyone context', () => {
    harvest([makeRecord(cand('a/b', { tags: ['eco:js'] }), 'h'), makeRecord(cand('c/d', { tags: ['eco:js'] }), 'h')]);
    const s = stats();
    expect(s.total).toBe(2);
    expect(s.byVerdict.unseen).toBe(2);
    expect(s.topTags[0]).toEqual(['eco:js', 2]);
  });
});
