import { describe, expect, it } from 'vitest';

import { convergent } from '../src/synth.mjs';

/**
 * Every fixture below is a REAL row shape from the loot ledger, including the tag sets.
 * The bug: a repository large enough to intersect any query saturates every signal the
 * ranker has -- framing count, domain tags AND proven usage -- so no single-signal
 * filter can discriminate it.
 */
const harness = {
  donor: 'deepseek-ai/deepseek-harness',
  surfaces: ['npm'],
  framings: Array.from({ length: 9 }, (_, i) => `f${i}`),
  tags: ['dom:graph', 'dom:isolation', 'dom:orchestration', 'dom:storage', 'dom:streaming', 'use:proven'],
  score: 37,
};
const focused = {
  donor: 'visulima/visulima',
  surfaces: ['npm'],
  framings: ['a', 'b', 'c'],
  tags: ['dom:orchestration'],
  score: 34,
};
const multiSurface = {
  donor: 'AshutoshMahala/ascii-dag',
  surfaces: ['crates', 'repo'],
  framings: ['a'],
  tags: ['dom:graph'],
  score: 33,
};

describe('convergent — a repo that answers everything tells you nothing', () => {
  it('drops the giant that saturated six tags at once', () => {
    expect(convergent([harness, focused]).map((r) => r.donor)).not.toContain(
      'deepseek-ai/deepseek-harness',
    );
  });

  it('keeps a focused single-surface row with a real mechanism', () => {
    expect(convergent([harness, focused]).map((r) => r.donor)).toContain('visulima/visulima');
  });

  /** Genuine multi-surface agreement never needed the breadth test. */
  it('never applies the breadth rule to a row with two build surfaces', () => {
    expect(convergent([multiSurface]).map((r) => r.donor)).toContain('AshutoshMahala/ascii-dag');
  });

  it('still refuses a single-surface row with no corroborating signal at all', () => {
    const bare = { donor: 'x/y', surfaces: ['npm'], framings: ['a', 'b', 'c'], tags: [], score: 90 };
    expect(convergent([bare])).toHaveLength(0);
  });

  /** Honest boundary: narrow-matching giants still get through. Documented, not hidden. */
  it('does NOT catch a giant that happens to match narrowly (known limit)', () => {
    const narrow = { ...harness, framings: ['a', 'b', 'c', 'd'], tags: ['dom:cli', 'use:proven'] };
    expect(convergent([narrow]).map((r) => r.donor)).toContain('deepseek-ai/deepseek-harness');
  });
});
