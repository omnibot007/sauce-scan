import { describe, expect, it } from 'vitest';

import { lintFraming } from '../src/framing.mjs';

const kinds = (f) => lintFraming(f).map((p) => p.kind);

/**
 * Both framings below really ran, really returned junk, and the junk is recorded.
 * The adjacent-domain trick has a boundary: the other field must SHIP CODE.
 */
describe('wrong-surface — fields that ship papers, not packages', () => {
  it('flags the librarian framing that returned Inquirer.js', () => {
    const p = lintFraming('reference interview question negotiation librarian');
    expect(p.map((x) => x.kind)).toContain('wrong-surface');
    expect(p.find((x) => x.kind === 'wrong-surface').hit).toContain('librarian');
  });

  it('flags the patent-examiner framing that returned a trading backtester', () => {
    const p = lintFraming('patent examiner prior art strategy');
    expect(p.map((x) => x.kind)).toContain('wrong-surface');
  });

  it('flags clinical and legal framings for the same reason', () => {
    expect(kinds('clinical trial endpoint adjudication')).toContain('wrong-surface');
    expect(kinds('auditor sampling materiality threshold')).toContain('wrong-surface');
  });

  it('tells you where to point it instead', () => {
    const p = lintFraming('archivist provenance chain custody');
    expect(p.find((x) => x.kind === 'wrong-surface').fix).toContain('papers');
  });

  it('does NOT flag fields that ship software', () => {
    for (const f of [
      'write ahead log crash consistency',
      'incremental build cache invalidate',
      'chess search pruning evaluate position',
      'job control background process shell',
      'language server workspace symbol index',
    ]) {
      expect(kinds(f)).not.toContain('wrong-surface');
    }
  });
});

/**
 * A VENDOR NAME colonises a word as hard as a framework does. Measured: the framing
 * `critical path slack estimate schedule` -- scheduling slack, the oldest term in
 * project planning -- returned slackapi/node-slack-sdk as its top-ranked hit.
 */
describe('colonised — vendor names that eat an ordinary word', () => {
  it('flags scheduling "slack", which returned the Slack SDK', () => {
    const p = lintFraming('critical path slack estimate schedule');
    expect(p.map((x) => x.kind)).toContain('colonised');
    expect(p.find((x) => x.kind === 'colonised').hit).toContain('slack');
  });

  it('still does not flag the planning framings that worked', () => {
    for (const f of [
      'topological sort dependency ordering tasks',
      'instruction scheduling critical path latency',
      'motion planning replan when precondition fails',
      'hierarchical task network decompose subgoals',
    ]) {
      expect(kinds(f)).not.toContain('colonised');
    }
  });
});
