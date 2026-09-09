import { describe, expect, it } from 'vitest';

import {
  domainsOf,
  ecosystemsOf,
  framingLabels,
  freshnessClass,
  labelCandidate,
  licenseClass,
} from '../src/labels.mjs';

const NOW = Date.parse('2026-09-09T00:00:00Z');

describe('licenseClass', () => {
  it('separates permissive, copyleft and unknown', () => {
    expect(licenseClass('MIT')).toBe('permissive');
    expect(licenseClass('apache-2.0')).toBe('permissive');
    expect(licenseClass('GPL-3.0')).toBe('copyleft');
    expect(licenseClass('AGPL-3.0')).toBe('copyleft');
    expect(licenseClass('BUSL-1.1')).toBe('copyleft');
    expect(licenseClass(null)).toBe('unknown');
    expect(licenseClass('WTFPL')).toBe('other');
  });
});

describe('freshnessClass', () => {
  it('buckets by age and names the graveyard', () => {
    expect(freshnessClass('2026-08-01', NOW)).toBe('fresh');
    expect(freshnessClass('2025-11-01', NOW)).toBe('aging');
    expect(freshnessClass('2022-03-20', NOW)).toBe('graveyard');
    expect(freshnessClass('', NOW)).toBe('unknown');
    expect(freshnessClass('not a date', NOW)).toBe('unknown');
  });
});

describe('ecosystemsOf', () => {
  it('maps surfaces to ecosystems and ignores the neutral ones', () => {
    expect(ecosystemsOf(['npm', 'crates']).sort()).toEqual(['js', 'rust']);
    expect(ecosystemsOf(['repo', 'code', 'ghcode'])).toEqual([]);
    expect(ecosystemsOf(['hf-models', 'hf-spaces'])).toEqual(['ml']);
  });
});

describe('domainsOf', () => {
  it('tags mechanisms, not topics', () => {
    expect(domainsOf('watchdog restarts a stalled worker')).toContain('supervision');
    expect(domainsOf('exponential backoff and retry on failure')).toContain('recovery');
    expect(domainsOf('append-only event sourced sqlite store')).toContain('storage');
    expect(domainsOf('memory poisoning attack surface')).toEqual(
      expect.arrayContaining(['memory', 'security']),
    );
  });

  it('returns nothing for text with no mechanism words', () => {
    expect(domainsOf('a delightful pastry recipe')).toEqual([]);
  });
});

describe('framingLabels — the sleeper label', () => {
  it('flags a candidate that only ONE framing found', () => {
    expect(framingLabels(['adjacent-domain'], 10)).toContain('single-framing');
  });

  it('does not flag single-framing when few framings were run', () => {
    expect(framingLabels(['a'], 2)).toEqual([]);
  });

  it('flags convergence across most framings', () => {
    expect(framingLabels(['a', 'b', 'c', 'd', 'e', 'f'], 8)).toContain('framing-convergent');
  });
});

describe('labelCandidate', () => {
  it('computes a full label set with no model call', () => {
    const tags = labelCandidate(
      {
        name: 'erlang/otp',
        surfaces: ['repo', 'code', 'hn'],
        framings: ['adjacent-domain'],
        details: ['supervision tree with restart policy and heartbeat'],
        license: 'APACHE-2.0',
        updated: '2026-08-15',
        downloads: 50000,
        relevance: 0.2,
      },
      { nowMs: NOW, totalFramings: 10 },
    );

    expect(tags).toEqual(
      expect.arrayContaining([
        'lic:permissive',
        'age:fresh',
        'dom:supervision',
        'fr:single-framing',
        'conv:strong',
        'has:code-match',
        'has:criticism',
        'use:proven',
        'lateral',
      ]),
    );
  });

  it('marks unknown licence and graveyard honestly', () => {
    const tags = labelCandidate(
      { name: 'x/y', surfaces: ['npm'], framings: [], details: [''], updated: '2021-01-01' },
      { nowMs: NOW, totalFramings: 5 },
    );
    expect(tags).toContain('lic:unknown');
    expect(tags).toContain('age:graveyard');
    expect(tags).toContain('eco:js');
  });

  it('is stable — same input, same labels', () => {
    const c = { name: 'a/b', surfaces: ['npm'], framings: ['f'], details: ['retry backoff'] };
    const one = labelCandidate(c, { nowMs: NOW, totalFramings: 4 });
    const two = labelCandidate(c, { nowMs: NOW, totalFramings: 4 });
    expect(one).toEqual(two);
  });
});
