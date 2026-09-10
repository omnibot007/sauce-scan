import { describe, expect, it } from 'vitest';

import { broadMatch, convergent } from '../src/synth.mjs';

/**
 * Every fixture below is a REAL row shape from the loot ledger, tag sets included.
 *
 * The original bug: CONVERGENT was defined as `>=2 surfaces OR >=3 framings`, and the OR
 * swallowed the section. Measured over 11,711 ledger rows, only 34 (0.29%) ever reach two
 * surfaces -- so every row that ever appeared under "near-certain relevance" arrived via
 * the framings branch, which measures breadth of match, not agreement.
 *
 * The fix is a SPLIT, not a filter: convergence means cross-surface agreement and is
 * honestly rare; framing breadth is a different signal that gets an honest name.
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
const crossSurface = {
  donor: 'ruvnet/ruvector',
  surfaces: ['npm', 'crates'],
  framings: ['a'],
  tags: ['dom:memory'],
  score: 40,
};
const paperOnly = {
  donor: 'arxiv:2401.00001',
  surfaces: ['papers'],
  framings: ['a', 'b', 'c', 'd'],
  tags: ['dom:eval'],
  score: 50,
};

describe('convergent — cross-surface agreement ONLY, and honestly rare', () => {
  it('admits a project two disjoint surfaces both found, even at ONE framing', () => {
    expect(convergent([crossSurface]).map((r) => r.donor)).toContain('ruvnet/ruvector');
  });

  it('refuses every single-surface row, however many framings it matched', () => {
    expect(convergent([harness, focused])).toHaveLength(0);
  });

  it('never lets a papers-only row count as convergence', () => {
    expect(convergent([paperOnly])).toHaveLength(0);
  });

  /** An empty section is the normal result. Emptiness must not throw or mislead. */
  it('returns empty rather than padding itself with the best of a bad lot', () => {
    expect(convergent([harness, focused, paperOnly])).toEqual([]);
  });
});

describe('broadMatch — where framing breadth goes, under an honest label', () => {
  it('keeps a focused single-surface row with a real mechanism', () => {
    expect(broadMatch([harness, focused]).map((r) => r.donor)).toContain('visulima/visulima');
  });

  /**
   * A giant repo does not inflate one signal, it SATURATES every signal at once.
   * Measured: deepseek-harness survived a mechanism-tag requirement carrying six tags.
   * So breadth of DOMAIN is evidence against relevance.
   */
  it('drops the giant that saturated six tags across five unrelated domains', () => {
    expect(broadMatch([harness, focused]).map((r) => r.donor)).not.toContain(
      'deepseek-ai/deepseek-harness',
    );
  });

  it('refuses a single-surface row with no corroborating signal at all', () => {
    const bare = { donor: 'x/y', surfaces: ['npm'], framings: ['a', 'b', 'c'], tags: [], score: 90 };
    expect(broadMatch([bare])).toHaveLength(0);
  });

  it('refuses a row that matched only one or two framings — that is not breadth', () => {
    const thin = { donor: 'x/y', surfaces: ['npm'], framings: ['a'], tags: ['dom:cli'], score: 90 };
    expect(broadMatch([thin])).toHaveLength(0);
  });

  it('does not double-count: a cross-surface row belongs to CONVERGENT, not here', () => {
    expect(broadMatch([crossSurface])).toHaveLength(0);
  });

  /** Honest boundary: a narrow-matching giant still gets through. Documented, not hidden. */
  it('does NOT catch a giant that happens to match narrowly (known limit)', () => {
    const narrow = { ...harness, framings: ['a', 'b', 'c', 'd'], tags: ['dom:cli', 'use:proven'] };
    expect(broadMatch([narrow]).map((r) => r.donor)).toContain('deepseek-ai/deepseek-harness');
  });
});

/**
 * gaps() already taught this file that "density is relative or it is meaningless".
 * broadMatch() briefly forgot: a fixed `>=3 framings` bar demands a PERFECT score on a
 * 3-framing raid and is trivial on a 28-framing one. Measured: BROAD MATCH came back
 * empty on a real 3-framing live run before the bar was made relative.
 */
describe('broadMatch — the bar scales with how many framings were cast', () => {
  const row = (donor, framings) => ({
    donor,
    surfaces: ['npm'],
    framings,
    tags: ['dom:orchestration'],
    score: 30,
  });

  it('admits 2-of-3 on a small raid, which a fixed bar of 3 would reject', () => {
    const rows = [row('a/b', ['f1', 'f2']), row('c/d', ['f3'])];
    expect(broadMatch(rows).map((r) => r.donor)).toContain('a/b');
  });

  it('still refuses 2-of-20 on a wide raid, where 2 is not breadth', () => {
    const wide = Array.from({ length: 20 }, (_, i) => row(`x/${i}`, [`f${i}`]));
    const rows = [...wide, row('a/b', ['f1', 'f2'])];
    expect(broadMatch(rows).map((r) => r.donor)).not.toContain('a/b');
  });

  it('admits a row matched by a quarter of a wide raid', () => {
    const wide = Array.from({ length: 20 }, (_, i) => row(`x/${i}`, [`f${i}`]));
    const rows = [...wide, row('a/b', ['f1', 'f2', 'f3', 'f4', 'f5'])];
    expect(broadMatch(rows).map((r) => r.donor)).toContain('a/b');
  });
});
