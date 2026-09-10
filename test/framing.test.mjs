import { describe, expect, it } from 'vitest';

import { lintFraming, lintFramingSet, renderLint } from '../src/framing.mjs';

const kinds = (f) => lintFraming(f).map((p) => p.kind);

describe('superlatives — the "best X" trap', () => {
  it('catches the shape that retrieves opinion instead of code', () => {
    expect(kinds('best agent browser')).toContain('superlative');
    expect(kinds('top rated coding agents')).toContain('superlative');
    expect(kinds('claude code vs cursor comparison')).toContain('superlative');
    expect(kinds('awesome agent alternatives review')).toContain('superlative');
  });

  it('leaves a behaviour framing alone', () => {
    expect(kinds('headless browser session persist across restart')).not.toContain('superlative');
  });
});

/**
 * Both of these were REAL framings that really ran and really returned junk.
 * They are regressions, not hypotheticals.
 */
describe('colonised tokens — measured failures', () => {
  it('catches "rules", which returned eslint-config in a clinical-trials framing', () => {
    const p = lintFraming('preregistration blinding stopping rules');
    expect(p.map((x) => x.kind)).toContain('colonised');
    expect(p.find((x) => x.kind === 'colonised').hit).toContain('rules');
  });

  it('catches "protocol", which returned a Postgres driver from an air-traffic framing', () => {
    const p = lintFraming('air traffic control handoff protocol');
    expect(p.map((x) => x.kind)).toContain('colonised');
    expect(p.find((x) => x.kind === 'colonised').hit).toContain('protocol');
  });

  it('catches "selection", which returned d3-selection typings', () => {
    expect(kinds('model selection cost optimization')).toContain('colonised');
  });

  it('passes the same ideas worded with distinctive vocabulary', () => {
    expect(kinds('randomized controlled trial preregistration')).not.toContain('colonised');
    expect(kinds('aircraft crew handoff briefing checklist')).not.toContain('colonised');
  });
});

describe('category vs mechanism', () => {
  it('flags a two-word category name', () => {
    expect(kinds('agent browser')).toContain('too-short');
  });

  it('accepts a framing that names a behaviour', () => {
    const k = kinds('detect stalled worker and restart it');
    expect(k).not.toContain('too-short');
    expect(k).not.toContain('no-mechanism');
  });

  it('gently notes a framing with no behaviour word', () => {
    expect(kinds('distributed knowledge graph systems')).toContain('no-mechanism');
  });
});

describe('the SET', () => {
  it('catches one framing written twice', () => {
    const issues = lintFramingSet([
      'multi agent orchestration supervisor',
      'multi agent orchestration framework',
      'detect stalled worker restart',
      'incremental cache invalidate',
      'write ahead log crash consistency',
      'aircraft crew handoff briefing',
    ]);
    expect(issues.map((i) => i.kind)).toContain('near-duplicate');
  });

  it('calls fewer than six framings a search, not a raid', () => {
    expect(lintFramingSet(['a b c', 'd e f']).map((i) => i.kind)).toContain('too-few');
  });

  it('passes a genuinely varied set of six', () => {
    const issues = lintFramingSet([
      'detect stalled worker and restart',
      'incremental build cache invalidate',
      'write ahead log crash consistency',
      'aircraft crew handoff briefing',
      'surgical checklist verify before incision',
      'chess search pruning evaluate position',
    ]);
    expect(issues).toEqual([]);
  });
});

describe('renderLint', () => {
  it('says nothing when the framings are clean', () => {
    expect(
      renderLint([
        'detect stalled worker and restart',
        'incremental build cache invalidate',
        'write ahead log crash consistency',
        'aircraft crew handoff briefing',
        'surgical checklist verify before incision',
        'chess search pruning evaluate position',
      ]),
    ).toBe('');
  });

  it('reports the fix, not just the problem', () => {
    const out = renderLint(['best agent browser', 'top agent browser']);
    expect(out).toContain('superlative');
    expect(out).toContain('->');
  });
});
