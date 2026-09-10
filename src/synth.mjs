/**
 * The miner — turn a corpus into findings.
 *
 * At thirty candidates you read a list. At a thousand you mine a corpus, and printing a
 * longer list is worthless: it is unreadable, and it would cost ~100k tokens of context
 * to hold. So the haul goes to the loot ledger and only THIS comes back.
 *
 * Six things a corpus can tell you that no single repository can:
 *   clusters      — how many distinct schools of thought exist here
 *   gaps          — what everybody solves vs what almost nobody does  <- the opportunity
 *   convergence   — found by many surfaces AND many framings; near-certain relevance
 *   laterals      — strong signal, different vocabulary; the unexpected steal
 *   graveyard     — what people tried and abandoned, which is its own answer
 *   vocabulary    — the words this field actually uses, so you know what to search next
 *
 * Everything here is deterministic. No model calls: a thousand of those would cost an
 * hour and blow the budget the whole design exists to respect.
 *
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 omninbot
 */

const STOP = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'you', 'your', 'are', 'not', '但',
  'a', 'an', 'of', 'to', 'in', 'on', 'is', 'it', 'as', 'by', 'or', 'be', 'can', 'has',
  'library', 'package', 'tool', 'simple', 'easy', 'fast', 'small', 'new', 'using', 'use',
  'based', 'built', 'support', 'like', 'more', 'all', 'via', 'when', 'each', 'into',
]);

function tagValues(rows, prefix) {
  const counts = new Map();
  for (const r of rows) {
    for (const t of r.tags ?? []) {
      if (!t.startsWith(prefix)) continue;
      const v = t.slice(prefix.length);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

/**
 * Group by primary domain. Deliberately simple and explainable: a candidate lands in
 * every domain it matched, so "how many schools of thought" is answerable by counting.
 */
export function clusters(rows, { minSize = 2 } = {}) {
  const byDomain = new Map();
  const unclustered = [];
  // Split the leftovers honestly. Several surfaces return no prose at all -- Software
  // Heritage gives "archived origin", HN gives "81 pts", OpenAlex gives "cited 313" --
  // so those candidates are UNCLASSIFIABLE, not uninteresting. Lumping them together
  // with described-but-unmatched rows would misreport a data limit as a miss.
  let noText = 0;
  for (const r of rows) {
    const domains = (r.tags ?? []).filter((t) => t.startsWith('dom:')).map((t) => t.slice(4));
    if (domains.length === 0) {
      const described = /[a-z]{4,}\s+[a-z]{4,}/i.test(String(r.summary ?? ''));
      if (described) unclustered.push(r);
      else noText += 1;
      continue;
    }
    for (const d of domains) byDomain.set(d, [...(byDomain.get(d) ?? []), r]);
  }
  const out = [...byDomain.entries()]
    .filter(([, members]) => members.length >= minSize)
    .map(([domain, members]) => ({
      domain,
      size: members.length,
      top: members.toSorted((a, b) => b.score - a.score).slice(0, 5),
      ecosystems: [...new Set(members.flatMap((m) => (m.tags ?? []).filter((t) => t.startsWith('eco:'))))],
    }))
    .sort((a, b) => b.size - a.size);
  return { clusters: out, unclustered: unclustered.length, noText };
}

/**
 * The gap analysis — the single most valuable output.
 *
 * A domain everybody implements is table stakes. A domain almost nobody implements,
 * in a corpus this size, is either genuinely hard or genuinely overlooked. Either way
 * that is where a new thing earns its existence.
 */
export function gaps(rows) {
  const counts = tagValues(rows, 'dom:');
  if (counts.length === 0) return { total: rows.length, crowded: [], sparse: [], absent: [] };

  // Thresholds are RELATIVE to the biggest cluster, never absolute percentages of the
  // corpus. Measured: a 315-candidate wide scan spread across 12 domains put the largest
  // at 4.8%, so an absolute 20% "crowded" bar reported EVERY domain as sparse -- which
  // is the same as reporting nothing. Density is relative or it is meaningless.
  const top = counts[0][1];
  const crowded = counts.filter(([, n]) => n >= top * 0.5);
  const sparse = counts.filter(([, n]) => n < top * 0.2 && n > 0);
  const pct = (n) => Math.round((n / top) * 100);
  return {
    total: rows.length,
    crowded: crowded.map(([d, n]) => ({ domain: d, n, pct: pct(n) })),
    sparse: sparse.map(([d, n]) => ({ domain: d, n, pct: pct(n) })),
    absent: [],
  };
}

/**
 * Found by many surfaces AND many framings. The closest thing to a sure bet.
 *
 * Papers are EXCLUDED from convergence unless they also appear on a build surface.
 * Measured: arXiv returns recent work for almost any query, so a paper trivially
 * "converges" across framings -- one raid nominated "Differential Polarization
 * Calibration: A Consistency Test for Cosmic Birefringence" as convergent evidence for
 * an eval-harness hunt. Paper convergence is an artefact of the index, not agreement.
 */
export function convergent(rows, limit = 15) {
  const BUILD = new Set(['npm', 'crates', 'pypi', 'repo', 'code', 'ghcode', 'list', 'mcp', 'hf-models', 'hf-spaces']);
  const buildSurfaces = (r) => (r.surfaces ?? []).filter((s) => BUILD.has(s));

  return rows
    .filter((r) => buildSurfaces(r).length >= 1)
    .filter((r) => buildSurfaces(r).length >= 2 || (r.framings?.length ?? 0) >= 3)
    .toSorted((a, b) => {
      const av = buildSurfaces(a).length * 2 + (a.framings?.length ?? 0);
      const bv = buildSurfaces(b).length * 2 + (b.framings?.length ?? 0);
      return bv - av || b.score - a.score;
    })
    .slice(0, limit);
}

/**
 * Laterals — the point of scanning wide.
 *
 * Strong on signal, weak on term overlap: somebody solved your problem in vocabulary you
 * did not think of. A `fr:single-framing` tag means exactly one of your framings opened
 * that door, and if that framing was the adjacent-domain one, this is the steal.
 */
export function laterals(rows, limit = 15) {
  // A lateral needs BOTH halves: different vocabulary AND real signal.
  //
  // Low term overlap alone is not a lateral, it is noise. Measured: a wide scan for
  // "multi agent orchestration supervisor" nominated `dmnd/dedent` ("strips indentation
  // from multi-line strings") and `yargs/cliui` ("multi-column command-line-interfaces")
  // purely on the token "multi". Requiring an independent signal -- convergence, proven
  // usage, a real code match, or a domain mechanism -- kills the whole class.
  // A mechanism tag is MANDATORY, not one option among several.
  //
  // Measured: allowing downloads to substitute for a mechanism let `eslint`, `parse5`
  // and `helmet` in -- they matched the tokens "tree" and "policy" out of the framing
  // "supervision tree restart policy" and outranked `heartbeat-rs` on npm popularity
  // alone. Popularity is not evidence that a thing does what you need.
  const isDifferent = (r) =>
    (r.tags ?? []).includes('lateral') || (r.tags ?? []).includes('fr:single-framing');
  const isMechanism = (r) => (r.tags ?? []).some((t) => t.startsWith('dom:'));

  return rows
    .filter((r) => isDifferent(r) && isMechanism(r) && r.score > 0)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** What was tried and abandoned. Absence of a live project is not absence of an answer. */
export function graveyard(rows, limit = 12) {
  return rows
    .filter((r) => (r.tags ?? []).includes('age:graveyard'))
    .toSorted((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * The vocabulary of the field, from the corpus's own words. Tells you what to search
 * next -- and what NOT to name your own thing.
 */
export function vocabulary(rows, limit = 30) {
  const counts = new Map();
  // Strip OUR OWN metadata before counting. Measured: the first vocabulary report read
  // "paper(120) cited(120) npm(98) crates(60) swh(11) archived(11) origin(11)" -- every
  // one of those is a surface prefix this tool prepends, not a word the field uses.
  // A vocabulary map that reports your own scaffolding back at you is worse than none.
  const NOISE = /\b(npm|crates|swh|pypi|hn|paper|arxiv|code|ghcode|repo|list|hf-\w+|mcp|cited|archived|origin|pts|comments)\b/g;
  for (const r of rows) {
    const words = `${r.summary ?? ''}`
      .toLowerCase()
      .replace(NOISE, ' ')
      .split(/[^a-z0-9+#.-]+/)
      .filter((w) => w.length > 2 && w.length < 24 && !STOP.has(w) && !/^\d+$/.test(w));
    for (const w of new Set(words)) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

/** Takeable now: permissive, alive, and scoring. The shortlist you act on today. */
export function takeables(rows, limit = 40) {
  return rows
    .filter((r) => (r.tags ?? []).includes('lic:permissive'))
    .filter((r) => !(r.tags ?? []).includes('age:graveyard'))
    .filter((r) => r.verdict !== 'rejected')
    // Must carry a MECHANISM. Without this the list ranks by raw npm popularity and
    // fills with whatever giant package happened to share a token with the framing.
    .filter((r) => (r.tags ?? []).some((t) => t.startsWith('dom:')))
    .toSorted((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function synthesize(rows, opts = {}) {
  return {
    total: rows.length,
    clusters: clusters(rows, opts),
    gaps: gaps(rows, opts),
    convergent: convergent(rows, opts.limit),
    laterals: laterals(rows, opts.limit),
    graveyard: graveyard(rows, opts.limit),
    vocabulary: vocabulary(rows, opts.vocabLimit),
    takeables: takeables(rows, opts.takeLimit),
    ecosystems: tagValues(rows, 'eco:'),
    licenses: tagValues(rows, 'lic:'),
  };
}

const line = (r) => `      ${r.donor}${r.score ? `  (${r.score})` : ''}${r.url ? `\n         ${r.url}` : ''}`;

/** Two pages. Never the haul. */
export function renderSynthesis(s, hunt) {
  const out = [`# OMNITHIEF: ${hunt}`, `${s.total} candidates harvested. Ledger holds them all; this is the read.`];

  out.push(`\n## CLUSTERS — ${s.clusters.clusters.length} schools of thought`);
  for (const c of s.clusters.clusters.slice(0, 12)) {
    out.push(`  ${String(c.size).padStart(4)}  ${c.domain}   ${c.ecosystems.join(' ')}`);
    for (const m of c.top.slice(0, 2)) out.push(line(m));
  }
  if (s.clusters.unclustered > 0) {
    out.push(`  ${String(s.clusters.unclustered).padStart(4)}  described, but no mechanism words matched`);
  }
  if (s.clusters.noText > 0) {
    out.push(`  ${String(s.clusters.noText).padStart(4)}  UNCLASSIFIABLE — the surface returned no description (swh/hn/papers)`);
  }

  out.push('\n## THE GAP — where the opportunity is');
  out.push(`  crowded: ${s.gaps.crowded.map((g) => `${g.domain} ${g.pct}%`).join(' · ') || '(none)'}`);
  out.push(`  SPARSE : ${s.gaps.sparse.map((g) => `${g.domain} ${g.n}`).join(' · ') || '(none)'}`);
  out.push('  Everyone solves the crowded ones. The sparse ones are hard or overlooked.');

  out.push('\n## CONVERGENT — many surfaces AND many framings agree');
  for (const r of s.convergent.slice(0, 8)) {
    out.push(`  ${r.donor}  [${(r.surfaces ?? []).join(',')}]  ${r.summary.slice(0, 80)}`);
  }

  out.push('\n## LATERAL — different vocabulary, same problem. READ THESE.');
  for (const r of s.laterals.slice(0, 8)) {
    out.push(`  ${r.donor}  <- ${(r.framings ?? []).join(',')}\n     ${r.summary.slice(0, 90)}`);
  }

  out.push('\n## GRAVEYARD — tried and abandoned');
  for (const r of s.graveyard.slice(0, 6)) out.push(`  ${r.donor}  ${r.summary.slice(0, 80)}`);

  out.push(`\n## VOCABULARY — what this field calls things`);
  out.push(`  ${s.vocabulary.slice(0, 24).map(([w, n]) => `${w}(${n})`).join(' ')}`);

  out.push(`\n## TAKEABLE NOW — permissive, alive, ranked (${s.takeables.length})`);
  for (const r of s.takeables.slice(0, 20)) {
    out.push(`  ${String(r.score).padStart(4)}  ${r.donor}\n        ${r.summary.slice(0, 100)}`);
  }
  return out.join('\n');
}
