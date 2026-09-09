// Prove the miner on a REAL corpus, not a fixture.
// Runs a live wide scan, labels it, mines it, prints the synthesis.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { labelCandidate } from '../src/labels.mjs';
import { makeRecord } from '../src/lootstore.mjs';
import { renderSynthesis, synthesize } from '../src/synth.mjs';

const run = promisify(execFile);
const hunt = process.argv[2] ?? 'multi agent orchestration supervisor';

const { stdout } = await run(
  process.execPath,
  [new URL('../sauce-scan.mjs', import.meta.url).pathname.replace(/^\//, ''), hunt, '--json'],
  { timeout: 600000, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
);
const scan = JSON.parse(stdout);

const framings = 3; // sauce-scan runs 3 phrasings by default
const rows = scan.candidates.map((c) => {
  const withFramings = { ...c, framings: c.framings ?? [hunt] };
  const tags = labelCandidate(withFramings, { totalFramings: framings });
  return makeRecord({ ...withFramings, tags }, hunt);
});

console.log(renderSynthesis(synthesize(rows), hunt));
console.log(`\n--- corpus: ${rows.length} candidates, ${rows.filter((r) => r.tags.length > 3).length} richly labelled ---`);
