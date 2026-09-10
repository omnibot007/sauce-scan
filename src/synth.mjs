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
 *   convergence   — the same project found by 2+ DISJOINT surfaces; rare (~0.3%) and real
 *   broad match   — one surface, many framings; central to the hunt, or merely large
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
 * Only BUILD surfaces can corroborate. Papers are excluded unless the project also
 * appears somewhere shippable. Measured: arXiv returns recent work for almost any query,
 * so a paper trivially "converges" across framings -- one raid nominated "Differential
 * Polarization Calibration: A Consistency Test for Cosmic Birefringence" as convergent
 * evidence for an eval-harness hunt. Paper convergence is an artefact of the index.
 */
const BUILD = new Set(['npm', 'crates', 'pypi', 'repo', 'code', 'ghcode', 'list', 'mcp', 'hf-models', 'hf-spaces']);
const buildSurfaces = (r) => (r.surfaces ?? []).filter((s) => BUILD.has(s));

/**
 * TRUE convergence: the same project found independently by TWO OR MORE build surfaces.
 *
 * This is now the whole definition, and it is deliberately strict. The previous rule was
 * `>=2 surfaces OR >=3 framings`, and the OR is what broke it: measured across the whole
 * ledger, WELL UNDER 1% of rows ever reach two surfaces (0.29% when last counted), so
 * every row that ever appeared in this section arrived through the framings branch
 * instead. The section labelled "near-certain relevance" was 100% breadth-of-match
 * artefacts in practice.
 *
 * The RATIO is the claim; the row count is a timestamp. `scripts/verify-claims.mjs`
 * re-checks both against the live ledger, because two absolute counts in this very file
 * went stale between being measured and being written down.
 *
 * Cross-surface agreement is rare for a STRUCTURAL reason, not a tuning one: the surfaces
 * index disjoint populations. npm indexes npm; crates indexes crates; a Rust crate cannot
 * appear on npm. So two surfaces agreeing is a real and independent signal -- it means the
 * project exists in two ecosystems or is both published and readable as source -- but it
 * can never be the common case.
 *
 * **An empty CONVERGENT section is the NORMAL result, not a failure.** That is why it now
 * reports its own rarity instead of padding itself with whatever matched the most queries.
 */
export function convergent(rows, limit = 15) {
  return rows
    .filter((r) => buildSurfaces(r).length >= 2)
    .toSorted(
      (a, b) => buildSurfaces(b).length - buildSurfaces(a).length || b.score - a.score,
    )
    .slice(0, limit);
}

/**
 * BROAD MATCH: one surface, many framings. This is what used to masquerade as
 * convergence, and it is a genuinely useful signal -- just a different one.
 *
 * Many framings hitting the same project means either "this is central to the hunt" or
 * "this repo is big enough to intersect anything." `corroborated()` separates those, and
 * the honest label stops the reader treating the second case as agreement.
 */
export function broadMatch(rows, limit = 15) {
  // The bar is RELATIVE to how many framings were actually cast, never a fixed 3.
  //
  // This file already learned this lesson once, in gaps(): "Density is relative or it is
  // meaningless." An absolute >=3 demands a PERFECT score on a 3-framing raid (measured:
  // BROAD MATCH came back empty on a real 3-framing run) while being trivial on a
  // 28-framing one. Same threshold, opposite meanings.
  const cast = new Set(rows.flatMap((r) => r.framings ?? [])).size;
  const bar = Math.max(2, Math.ceil(cast * 0.25));

  return rows
    .filter((r) => buildSurfaces(r).length === 1)
    .filter((r) => corroborated(r, bar))
    .toSorted(
      (a, b) =>
        (b.framings?.length ?? 0) * sizeFactor(b) - (a.framings?.length ?? 0) * sizeFactor(a) ||
        b.score - a.score,
    )
    .slice(0, limit);
}

/**
 * A single-surface row needs INDEPENDENT corroboration before its framing count counts
 * as agreement. This mirrors the rule `laterals()` already enforces, and it is the same
 * bug in a different section: an index that answers everything makes any query look
 * convergent.
 *
 * Measured on 2,072 real ledger rows: the OLD rule (`>=2 surfaces OR >=3 framings`)
 * admitted 14 rows, and ALL 14 came in on framings alone with exactly one surface --
 * `deepseek-ai/deepseek-harness` at 9 framings on `npm` and nothing else. Zero rows had
 * two build surfaces, so the surface branch was dead code and the whole CONVERGENT
 * section was the artefact class.
 *
 * A mechanism tag, a real code match, or proven usage is evidence a human did not
 * fabricate. A framing count on one surface is not.
 */
function corroborated(r, bar = 3) {
  const tags = r.tags ?? [];
  const domains = tags.filter((t) => t.startsWith('dom:'));
  const hasSignal =
    domains.length > 0 || tags.includes('has:code-match') || tags.includes('use:proven');
  if (!hasSignal || (r.framings?.length ?? 0) < bar) return false;

  // THE TELL, and the reason a single-signal filter was not enough. A huge repository
  // does not merely inflate its framing count -- it SATURATES every signal the ranker
  // has. Measured: `deepseek-ai/deepseek-harness` survived a mechanism-tag requirement
  // carrying SIX tags at once -- dom:graph, dom:isolation, dom:orchestration,
  // dom:storage, dom:streaming and use:proven.
  //
  // So breadth is evidence AGAINST relevance, not for it. A focused tool answers one or
  // two domains. A repo that answers five unrelated ones is not convergent with your
  // hunt; it is simply large enough to intersect anything. Same shape as the papers bug:
  // a source that answers everything tells you nothing.
  return domains.length <= 2;
}

/**
 * A giant repository matches almost any query, so its framing count is not agreement.
 * Measured: `deepseek-ai/deepseek-harness` (217,603 stars) matched 9 of 12 framings.
 *
 * NOTE, verified: `makeRecord()` does not persist `stars`, so every ledger row reads 0
 * here and this factor is inert in `--ledger` mode. It fires at scan time only. That is
 * exactly why the fix above does NOT depend on it -- a size penalty alone would have
 * looked correct in a unit test and done nothing where the tool is actually used.
 */
function sizeFactor(r) {
  const stars = r.stars ?? 0;
  if (stars >= 100_000) return 0.25;
  if (stars >= 20_000) return 0.5;
  return 1;
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

  // The SAME saturation guard convergence needed, because this section had the same hole.
  // Measured: `deepseek-ai/deepseek-harness` led the LATERAL band of the planner hunt
  // carrying six domain tags. A mechanism requirement cannot discriminate a repo that
  // satisfies every mechanism. A lateral is a FOCUSED tool found through an unexpected
  // door -- if it answers five unrelated domains it did not come through a door, it fills
  // the whole building.
  const isFocused = (r) => (r.tags ?? []).filter((t) => t.startsWith('dom:')).length <= 2;

  return rows
    .filter((r) => isDifferent(r) && isMechanism(r) && isFocused(r) && r.score > 0)
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
    broadMatch: broadMatch(rows, opts.limit),
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

  out.push(`\n## CONVERGENT — the SAME project found by 2+ independent surfaces (${s.convergent.length})`);
  if (s.convergent.length === 0) {
    out.push('  none — and that is the NORMAL result, not a miss. Only ~0.3% of harvested');
    out.push('  rows ever reach two surfaces, because the surfaces index disjoint');
    out.push('  populations: a Rust crate cannot appear on npm. Read BROAD MATCH instead.');
  }
  for (const r of s.convergent.slice(0, 8)) {
    out.push(`  ${r.donor}  [${(r.surfaces ?? []).join(',')}]  ${r.summary.slice(0, 80)}`);
  }

  out.push(`\n## BROAD MATCH — one surface, many framings. Central to the hunt, or merely large (${s.broadMatch.length})`);
  for (const r of s.broadMatch.slice(0, 8)) {
    const doms = (r.tags ?? []).filter((t) => t.startsWith('dom:')).length;
    out.push(`  ${r.donor}  [${(r.framings ?? []).length} framings · ${doms} domain${doms === 1 ? '' : 's'}]`);
    out.push(`     ${r.summary.slice(0, 84)}`);
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
