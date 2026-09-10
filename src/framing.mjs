/**
 * The framing linter.
 *
 * The single biggest determinant of what a raid finds is not the tool, the surfaces, or
 * the limits. It is HOW THE QUESTION IS WORDED. Three shapes of the same question reach
 * three different populations:
 *
 *   "best agent browser"        -> listicles and rankings. COMMENTARY about the category.
 *   "agent browser"             -> things that self-IDENTIFY as that category.
 *   "headless session persist"  -> IMPLEMENTATIONS, whatever they call themselves.
 *
 * Only the third finds the project that solves your problem under a different name --
 * and that project is usually the good one, because it was built by someone solving the
 * problem rather than someone marketing to your category.
 *
 * Measured, twice, on this machine:
 *   - `preregistration blinding stopping RULES` returned 92 rows of eslint-config rules,
 *     PostCSS rules and React Hooks rules. "rules" means lint rules in npm-land.
 *   - `air traffic control handoff PROTOCOL` returned a Postgres wire-protocol driver.
 *     The author of that framing had written the law against this twenty minutes earlier.
 *
 * So the machine checks now, because the human demonstrably will not.
 *
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 omninbot
 */

/** Words that retrieve OPINION instead of CODE. */
export const SUPERLATIVES = [
  'best', 'top', 'greatest', 'ultimate', 'perfect', 'fastest', 'popular', 'leading',
  'favourite', 'favorite', 'recommended', 'compare', 'comparison', 'vs', 'versus',
  'alternative', 'alternatives', 'review', 'reviews', 'guide', 'tutorial', 'roundup',
];

/**
 * Tokens the JS/TS ecosystem has colonised. A framing containing one of these mostly
 * retrieves that ecosystem's dominant meaning, drowning whatever you meant.
 */
export const COLONISED = [
  'rules', 'config', 'plugin', 'tree', 'policy', 'core', 'utils', 'util', 'runner',
  'test', 'tests', 'hook', 'hooks', 'stream', 'node', 'client', 'server', 'manager',
  'handler', 'service', 'selection', 'protocol', 'parser', 'loader', 'builder',
  'helper', 'wrapper', 'adapter', 'provider', 'context', 'state', 'store', 'router',
];

/**
 * Fields that solved your problem in JOURNALS AND PRACTICE, not in packages.
 *
 * The adjacent-domain trick has a boundary, and it is this: it only pays when the other
 * field ALSO SHIPS CODE. Databases, shells, build systems and chess engines pay,
 * because they publish software. Library science, patent examination, evidence-based
 * medicine and law solved "find the thing that is worded differently" more rigorously
 * than any of them -- and shipped none of it to npm.
 *
 * Measured: `reference interview question negotiation librarian` returned Inquirer.js
 * (interactive CLI prompts), d3-array and an HTTP content negotiator.
 * `patent examiner prior art strategy` returned a trading backtester and a Mermaid
 * renderer. Zero controlled-vocabulary tooling, because there is none to find.
 *
 * These framings are not wrong. They are pointed at the wrong SURFACE.
 */
const METHODOLOGY_FIELDS = [
  'librarian', 'library', 'archivist', 'curator', 'cataloguer', 'cataloger',
  'examiner', 'patent', 'attorney', 'litigation', 'discovery', 'paralegal',
  'clinician', 'clinical', 'epidemiology', 'nursing', 'radiologist',
  'pedagogy', 'ethnography', 'anthropologist', 'historian', 'archaeology',
  'auditor', 'actuary', 'accountant', 'regulator', 'inspector',
];

/** Verbs that describe BEHAVIOUR. A framing with one of these is doing it right. */
const MECHANISM_VERBS = [
  'detect', 'detects', 'recover', 'recovery', 'retry', 'restart', 'resume', 'persist',
  'isolate', 'snapshot', 'rollback', 'invalidate', 'cache', 'schedule', 'preempt',
  'throttle', 'batch', 'stream', 'dedupe', 'reconcile', 'verify', 'validate', 'prune',
  'expire', 'compact', 'replay', 'checkpoint', 'supervise', 'route', 'fallback',
  'sandbox', 'audit', 'trace', 'measure', 'sample', 'rank', 'merge', 'diff', 'lock',
];

const words = (s) => String(s).toLowerCase().split(/[^a-z0-9+#.-]+/).filter(Boolean);

/**
 * Lint one framing. Returns problems worth telling a human about, never throws --
 * a warned framing still runs, because a noisy hit beats a missed one.
 */
export function lintFraming(framing) {
  const w = words(framing);
  const problems = [];

  const supers = w.filter((x) => SUPERLATIVES.includes(x));
  if (supers.length > 0) {
    problems.push({
      severity: 'high',
      kind: 'superlative',
      hit: supers,
      why: `"${supers[0]}" retrieves opinion ABOUT the category, not code that does the job`,
      fix: 'describe what the thing DOES, not how good it is',
    });
  }

  const colonised = w.filter((x) => COLONISED.includes(x));
  if (colonised.length > 0) {
    problems.push({
      severity: 'high',
      kind: 'colonised',
      hit: colonised,
      why: `"${colonised[0]}" is owned by the JS/TS ecosystem and will drown your meaning`,
      fix: "use the other field's DISTINCTIVE word, not the half it shares with npm",
    });
  }

  const methodology = w.filter((x) => METHODOLOGY_FIELDS.includes(x));
  if (methodology.length > 0) {
    problems.push({
      severity: 'medium',
      kind: 'wrong-surface',
      hit: methodology,
      why: `"${methodology[0]}" names a field that ships PAPERS, not packages — a code scan finds nothing`,
      fix: 'route this framing to --surfaces papers,swh — or borrow from a field that publishes software',
    });
  }

  if (w.length <= 2) {
    problems.push({
      severity: 'medium',
      kind: 'too-short',
      hit: w,
      why: 'two words names a CATEGORY; you get things that self-identify, not things that work',
      fix: 'add the behaviour: what does it actually do when it runs?',
    });
  }

  const hasMechanism = w.some((x) => MECHANISM_VERBS.includes(x));
  if (!hasMechanism && problems.length === 0) {
    problems.push({
      severity: 'low',
      kind: 'no-mechanism',
      hit: [],
      why: 'no behaviour word — this may retrieve a category rather than an implementation',
      fix: `consider a verb: ${MECHANISM_VERBS.slice(0, 8).join(', ')}...`,
    });
  }

  return problems;
}

/**
 * Lint the SET. Framings that are near-duplicates are one framing written N times, and
 * that is the failure the whole raid design exists to avoid.
 */
export function lintFramingSet(framings) {
  const issues = [];
  const sets = framings.map((f) => new Set(words(f).filter((x) => x.length > 2)));

  for (let i = 0; i < framings.length; i += 1) {
    for (let j = i + 1; j < framings.length; j += 1) {
      const a = sets[i];
      const b = sets[j];
      const shared = [...a].filter((x) => b.has(x));
      const overlap = shared.length / Math.min(a.size, b.size);
      if (overlap >= 0.6) {
        issues.push({
          severity: 'medium',
          kind: 'near-duplicate',
          pair: [framings[i], framings[j]],
          why: `${Math.round(overlap * 100)}% word overlap — this is one framing written twice`,
          fix: 'replace one with a framing a DIFFERENT FIELD would use',
        });
      }
    }
  }

  if (framings.length < 6) {
    issues.push({
      severity: 'high',
      kind: 'too-few',
      why: `${framings.length} framings is a search, not a raid`,
      fix: 'write 8-14, at least a third borrowed from other fields',
    });
  }

  return issues;
}

export function renderLint(framings) {
  const lines = [];
  for (const f of framings) {
    const problems = lintFraming(f).filter((p) => p.severity !== 'low');
    if (problems.length === 0) continue;
    lines.push(`  ! "${f}"`);
    for (const p of problems) lines.push(`      ${p.kind}: ${p.why}\n      -> ${p.fix}`);
  }
  for (const i of lintFramingSet(framings)) {
    if (i.kind === 'near-duplicate') lines.push(`  ! near-duplicate: "${i.pair[0]}" / "${i.pair[1]}"\n      ${i.why}`);
    else lines.push(`  ! ${i.kind}: ${i.why}\n      -> ${i.fix}`);
  }
  return lines.length === 0 ? '' : ['FRAMING LINT', ...lines].join('\n');
}
