/**
 * Deterministic labelling.
 *
 * Every label here is COMPUTED from metadata already in hand. Zero model calls, zero
 * cost, instant. That constraint is load-bearing: labelling 1000 candidates with an LLM
 * would cost an hour and real money, and the whole hunt has a 20-minute budget.
 *
 * The `framing` label is the sleeper. When a candidate appears ONLY under an
 * adjacent-domain framing -- the supervision-tree query rather than the AI one -- that
 * is the unexpected steal, and it gets flagged automatically instead of hoped for.
 *
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 omninbot
 */

export const PERMISSIVE = new Set([
  'MIT', 'APACHE-2.0', 'BSD-2-CLAUSE', 'BSD-3-CLAUSE', 'ISC', 'UNLICENSE', '0BSD', 'MPL-2.0',
]);
export const COPYLEFT = /^(GPL|AGPL|LGPL|SSPL|BUSL|ELASTIC)/i;

const YEAR = 365 * 24 * 3600 * 1000;

/** Which package ecosystem a surface implies. Free signal nobody has to infer. */
const ECOSYSTEM = {
  npm: 'js', code: null, ghcode: null, repo: null, list: null,
  crates: 'rust', pypi: 'python', 'hf-models': 'ml', 'hf-spaces': 'ml',
  mcp: 'mcp', swh: 'archive', hn: 'discussion', paper: 'research', arxiv: 'research',
};

/**
 * Domain tags, matched against a candidate's OWN words. Deliberately about mechanisms
 * rather than topics: "what does this thing DO" survives across problem domains, which
 * is what makes an adjacent-domain steal findable.
 */
const DOMAIN_PATTERNS = [
  ['memory', /\b(memor(y|ies)|recall|retention|remember)\b/i],
  ['retrieval', /\b(retriev|rag|embedding|vector|bm25|rerank)\b/i],
  ['provenance', /\b(provenance|citation|attribut|audit trail|lineage)\b/i],
  ['supervision', /\b(supervis|watchdog|heartbeat|liveness|restart polic)\b/i],
  ['recovery', /\b(retry|backoff|failover|recover|resume|checkpoint|durab)\b/i],
  ['orchestration', /\b(orchestrat|workflow|scheduler|dispatch|fan.?out|dag|pipeline)\b/i],
  ['isolation', /\b(sandbox|isolat|worktree|container|namespace)\b/i],
  ['routing', /\b(rout(e|ing|er)|dispatch|classif|handoff|delegat)\b/i],
  ['eval', /\b(eval|benchmark|scoring|verif|assert|test harness)\b/i],
  ['budget', /\b(token count|budget|cost|quota|rate limit|throttl)\b/i],
  ['security', /\b(poison|injection|tamper|integrity|threat|attack)\b/i],
  ['storage', /\b(sqlite|postgres|jsonl|append.?only|event.?source|store|database)\b/i],
  ['graph', /\b(graph|knowledge graph|triple|ontolog|node.*edge)\b/i],
  ['streaming', /\b(stream|sse|websocket|incremental|realtime)\b/i],
  ['cli', /\b(\bcli\b|command.?line|terminal|tui)\b/i],
];

export function licenseClass(license) {
  if (!license) return 'unknown';
  const up = String(license).toUpperCase();
  if (COPYLEFT.test(up)) return 'copyleft';
  if (PERMISSIVE.has(up)) return 'permissive';
  return 'other';
}

export function freshnessClass(updated, nowMs = Date.now()) {
  if (!updated) return 'unknown';
  const t = Date.parse(updated);
  if (!Number.isFinite(t)) return 'unknown';
  const age = nowMs - t;
  if (age < YEAR / 2) return 'fresh';
  if (age < 2 * YEAR) return 'aging';
  return 'graveyard';
}

export function ecosystemsOf(surfaces) {
  const out = new Set();
  for (const s of surfaces) {
    const eco = ECOSYSTEM[s];
    if (eco) out.add(eco);
  }
  return [...out];
}

export function domainsOf(text) {
  const hay = String(text ?? '');
  return DOMAIN_PATTERNS.filter(([, re]) => re.test(hay)).map(([name]) => name);
}

/**
 * A candidate found by only ONE framing, when many were run, came in through a door the
 * others did not open. If that framing was the adjacent-domain one, this is the find the
 * whole wide scan exists to produce.
 */
export function framingLabels(framings, totalFramings) {
  const labels = [];
  if (framings.length === 1 && totalFramings > 2) labels.push('single-framing');
  if (framings.length >= Math.max(3, Math.ceil(totalFramings * 0.6))) labels.push('framing-convergent');
  return labels;
}

export function labelCandidate(c, opts = {}) {
  const nowMs = opts.nowMs ?? Date.now();
  const totalFramings = opts.totalFramings ?? 1;
  const surfaces = [...(c.surfaces ?? [])];
  const framings = [...(c.framings ?? [])];

  const tags = new Set();
  tags.add(`lic:${licenseClass(c.license)}`);
  tags.add(`age:${freshnessClass(c.updated, nowMs)}`);
  for (const eco of ecosystemsOf(surfaces)) tags.add(`eco:${eco}`);
  for (const d of domainsOf(`${c.name} ${(c.details ?? []).join(' ')}`)) tags.add(`dom:${d}`);
  for (const f of framingLabels(framings, totalFramings)) tags.add(`fr:${f}`);

  if (surfaces.length >= 3) tags.add('conv:strong');
  else if (surfaces.length === 2) tags.add('conv:weak');
  if (surfaces.includes('code') || surfaces.includes('ghcode')) tags.add('has:code-match');
  if (surfaces.includes('hn')) tags.add('has:criticism');
  if (surfaces.includes('paper') || surfaces.includes('arxiv')) tags.add('has:paper');
  if (typeof c.downloads === 'number' && c.downloads >= 10000) tags.add('use:proven');
  if ((c.relevance ?? 1) <= 0.34) tags.add('lateral');

  return [...tags].sort();
}
