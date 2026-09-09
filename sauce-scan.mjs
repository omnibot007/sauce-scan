#!/usr/bin/env node
/**
 * sauce-scan — multi-surface discovery for the /sauce skill.
 *
 * GitHub repo search answers "does a project exist for X". It is bad at "show me code
 * that does X", and it is one population among many. This hits every surface PROVEN
 * reachable and keyless from this machine, then does the part a search box never does:
 * collapses hits into ranked CANDIDATES with reasons.
 *
 * Probed and DEAD — do not re-add:
 *   grep.app      HTTP 429 + HTML error page under any headers. Blocks automation.
 *   libraries.io  HTTP 401, needs a key.
 *   godoc.org     retired.
 *   zenodo        returns HTML, not JSON.
 *
 * Zero dependencies. Node 18+ (global fetch).
 *
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 omninbot
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const UA = 'sauce-scan/2.0 (+local research)';
const TIMEOUT = 20000;
const APEX = 'C:/Users/LENOVO/tools/apex-memory/dist';
const LOOT_PROJECT = 'sauce-loot';

const enc = encodeURIComponent;

async function getJson(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getText(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, ...headers },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function gh(args) {
  const { stdout } = await run('gh', args, { timeout: TIMEOUT, windowsHide: true });
  return stdout;
}

/**
 * Surfaces do not all take the same query shape. A three-word phrase is fine for a
 * GitHub repo search and useless against an exact-name registry lookup or a substring
 * filter. Narrow to the most distinctive one or two terms for those.
 */
const STOP = new Set(['the', 'a', 'an', 'for', 'of', 'and', 'with', 'in', 'to', 'on', 'agent', 'ai']);
function headTerms(q, n = 2) {
  const words = q.split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w.toLowerCase()));
  const picked = (words.length > 0 ? words : q.split(/\s+/)).slice(0, n);
  return picked.join(' ');
}

/** Normalise anything that points at GitHub into `owner/repo`, else null. */
function repoKey(url) {
  if (typeof url !== 'string') return null;
  const m = /github\.com[/:]([^/\s]+)\/([^/\s#?]+)/i.exec(url);
  if (m === null) return null;
  return `${m[1]}/${m[2].replace(/\.git$/, '')}`;
}

/* ------------------------------------------------------------------ surfaces */

async function sourcegraph(q, limit) {
  const body = await getText(
    `https://sourcegraph.com/.api/search/stream?q=${enc(`${q} count:${limit}`)}`,
    { Accept: 'text/event-stream' },
  );
  const out = [];
  let event = '';
  for (const line of body.split('\n')) {
    if (line.startsWith('event: ')) event = line.slice(7).trim();
    if (!line.startsWith('data: ') || event !== 'matches') continue;
    let rows;
    try {
      rows = JSON.parse(line.slice(6));
    } catch {
      continue;
    }
    for (const m of Array.isArray(rows) ? rows : []) {
      const repo = String(m.repository ?? '').replace(/^github\.com\//, '');
      const snip = (m.chunkMatches?.[0]?.content ?? m.lineMatches?.[0]?.preview ?? '').trim();
      out.push({
        surface: 'code',
        name: repo,
        detail: `${m.path ?? ''}  ${snip.slice(0, 90)}`,
        url: `https://github.com/${repo}`,
      });
    }
  }
  return out.slice(0, limit);
}

/** Second mechanism engine. Authenticated via gh, so better limits than anonymous SG. */
async function ghCode(q, limit) {
  try {
    const rows = JSON.parse(await gh(['search', 'code', q, '--limit', String(limit), '--json', 'repository,path']));
    return rows.map((r) => ({
      surface: 'ghcode',
      name: r.repository?.nameWithOwner,
      detail: r.path ?? '',
      url: `https://github.com/${r.repository?.nameWithOwner}`,
    }));
  } catch {
    return [];
  }
}

async function ghSearch(q, limit, surface = 'repo') {
  try {
    const rows = JSON.parse(
      await gh([
        'search', 'repos', q, '--limit', String(limit), '--sort', 'stars',
        '--json', 'fullName,description,stargazersCount,license,updatedAt,url',
      ]),
    );
    return rows.map((r) => ({
      surface,
      name: r.fullName,
      stars: r.stargazersCount,
      license: r.license?.key?.toUpperCase() ?? null,
      updated: String(r.updatedAt ?? '').slice(0, 10),
      detail: (r.description ?? '').slice(0, 120),
      url: r.url,
    }));
  } catch {
    return [];
  }
}

async function awesomeLists(q, limit) {
  return ghSearch(`awesome ${headTerms(q, 2)}`, limit, 'list');
}

async function npm(q, limit) {
  const j = await getJson(`https://registry.npmjs.org/-/v1/search?text=${enc(q)}&size=${limit}`);
  const rows = (j.objects ?? []).map((o) => ({
    surface: 'npm',
    name: o.package?.name,
    license: o.package?.license?.toUpperCase() ?? null,
    updated: String(o.package?.date ?? '').slice(0, 10),
    detail: (o.package?.description ?? '').slice(0, 110),
    url: o.package?.links?.repository ?? o.package?.links?.npm,
  }));
  await Promise.all(
    rows.map(async (r) => {
      try {
        const d = await getJson(`https://api.npmjs.org/downloads/point/last-week/${r.name}`);
        r.downloads = d.downloads ?? 0;
      } catch {
        r.downloads = 0;
      }
    }),
  );
  return rows;
}

async function crates(q, limit) {
  const j = await getJson(`https://crates.io/api/v1/crates?q=${enc(q)}&per_page=${limit}`);
  return (j.crates ?? []).map((c) => ({
    surface: 'crates',
    name: c.name,
    downloads: c.downloads,
    license: c.license?.toUpperCase() ?? null,
    updated: String(c.updated_at ?? '').slice(0, 10),
    detail: (c.description ?? '').slice(0, 110),
    url: c.repository ?? `https://crates.io/crates/${c.name}`,
  }));
}

async function pypi(q) {
  try {
    const j = await getJson(`https://pypi.org/pypi/${enc(headTerms(q, 1).replace(/\s+/g, '-'))}/json`);
    return [{
      surface: 'pypi',
      name: j.info?.name,
      license: j.info?.license?.toUpperCase() || null,
      detail: (j.info?.summary ?? '').slice(0, 110),
      url: j.info?.project_urls?.Source ?? j.info?.package_url,
    }];
  } catch {
    return [];
  }
}

async function hf(q, limit) {
  const out = [];
  for (const kind of ['models', 'spaces']) {
    try {
      const j = await getJson(`https://huggingface.co/api/${kind}?search=${enc(q)}&limit=${limit}`);
      for (const r of Array.isArray(j) ? j : []) {
        out.push({
          surface: `hf-${kind}`,
          name: r.id,
          license: r.cardData?.license?.toUpperCase() ?? null,
          detail: (r.pipeline_tag ?? r.sdk ?? '').slice(0, 60),
          url: `https://huggingface.co/${kind === 'spaces' ? 'spaces/' : ''}${r.id}`,
        });
      }
    } catch {
      /* one surface failing is not the scan failing */
    }
  }
  return out;
}

async function mcpRegistry(q, limit) {
  const j = await getJson('https://registry.modelcontextprotocol.io/v0/servers?limit=100');
  const needle = headTerms(q, 1).toLowerCase();
  return (j.servers ?? [])
    .map((row) => row.server ?? row)
    .filter((s) => `${s.name} ${s.description ?? ''}`.toLowerCase().includes(needle))
    .slice(0, limit)
    .map((s) => ({
      surface: 'mcp',
      name: s.name,
      detail: (s.description ?? '').slice(0, 110),
      url: s.repository?.url ?? s.remotes?.[0]?.url ?? '',
    }));
}

async function softwareHeritage(q, limit) {
  const j = await getJson(
    `https://archive.softwareheritage.org/api/1/origin/search/${enc(headTerms(q, 2))}/?limit=${limit}`,
  );
  return (Array.isArray(j) ? j : []).map((o) => ({
    surface: 'swh',
    name: String(o.url).replace(/^https?:\/\//, ''),
    detail: 'archived origin',
    url: o.url,
  }));
}

/**
 * The CRITICISM surface. Every other surface reports what a project CLAIMS.
 * HN threads report what broke for somebody. Phase 2 says distrust self-reported
 * quality; this is where the counter-evidence actually lives.
 */
async function hackernews(q, limit) {
  // tags=story excludes comment hits, and a points floor kills the monthly megathreads.
  // Measured without them: "multi agent LLM orchestration" returned three consecutive
  // "Ask HN: Who wants to be hired?" threads at 0 points, because those threads contain
  // every term in their comments.
  const j = await getJson(
    `https://hn.algolia.com/api/v1/search?query=${enc(q)}&tags=story&numericFilters=${enc('points>=20')}&hitsPerPage=${limit}`,
  );
  return (j.hits ?? []).map((h) => ({
    surface: 'hn',
    name: (h.title ?? h.story_title ?? '').slice(0, 90),
    detail: `${h.points ?? 0} pts · ${h.num_comments ?? 0} comments · ${String(h.created_at ?? '').slice(0, 10)}`,
    url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
  }));
}

async function papers(q, limit) {
  const out = [];
  try {
    // Relevance, NOT citation count: sorting a niche query by citations returns famous
    // papers that merely share tokens (measured: a 3D medical imaging platform).
    const j = await getJson(`https://api.openalex.org/works?search=${enc(q)}&per-page=${limit}`);
    for (const w of j.results ?? []) {
      out.push({
        surface: 'paper',
        name: (w.title ?? '').slice(0, 90),
        detail: `cited ${w.cited_by_count ?? 0} · ${String(w.publication_date ?? '').slice(0, 4)}`,
        url: w.doi ?? w.id,
      });
    }
  } catch {
    /* ignore */
  }
  try {
    const xml = await getText(
      `http://export.arxiv.org/api/query?search_query=all:${enc(q)}&max_results=${limit}&sortBy=submittedDate&sortOrder=descending`,
    );
    for (const entry of xml.split('<entry>').slice(1)) {
      const title = /<title>([\s\S]*?)<\/title>/.exec(entry)?.[1]?.replace(/\s+/g, ' ').trim();
      const id = /<id>(.*?)<\/id>/.exec(entry)?.[1];
      if (title) out.push({ surface: 'arxiv', name: title.slice(0, 90), detail: '', url: id ?? '' });
    }
  } catch {
    /* ignore */
  }
  return out;
}

const SURFACES = {
  lists: awesomeLists,
  code: sourcegraph,
  ghcode: ghCode,
  repo: (q, n) => ghSearch(q, n),
  npm,
  crates,
  pypi,
  hf,
  mcp: mcpRegistry,
  swh: softwareHeritage,
  hn: hackernews,
  papers,
};

/* --------------------------------------------------------------- loot memory */

/** Prior verdicts, so the same donor is never evaluated from scratch twice. */
async function loadPriors() {
  try {
    const { recallInForce } = await import(`file:///${APEX}/custody.js`);
    const { JsonlCustodyStore } = await import(`file:///${APEX}/store.js`);
    const rows = await recallInForce(new JsonlCustodyStore(), LOOT_PROJECT, {
      minAuthority: 'conjecture',
      limit: 2000,
    });
    const map = new Map();
    for (const r of rows) {
      const m = /^([^\s:]+):\s*(took|rejected|pending)\b\s*—?\s*(.*)$/i.exec(r.text);
      if (m !== null) map.set(m[1].toLowerCase(), { verdict: m[2].toLowerCase(), why: m[3] });
    }
    return map;
  } catch {
    return new Map();
  }
}

async function remember(donor, verdict, why) {
  const { record } = await import(`file:///${APEX}/custody.js`);
  const { JsonlCustodyStore } = await import(`file:///${APEX}/store.js`);
  const now = Date.now();
  const text = `${donor}: ${verdict} — ${why}`;
  const sourceText = `sauce-scan verdict recorded ${new Date(now).toISOString()}\n${text}`;
  await record(new JsonlCustodyStore(), {
    project: LOOT_PROJECT,
    kind: 'pattern',
    text,
    quote: text,
    sourceText,
    sourceKind: 'verified-command',
    claimedAuthority: 'fact',
    sourceLocator: `sauce-scan#${donor}`,
    sourceSession: 'sauce-scan',
    validFromMs: now,
    recordedAtMs: now,
  });
  return text;
}

/* ------------------------------------------------------- convergence scoring */

const YEAR = 365 * 24 * 3600 * 1000;
const PERMISSIVE = new Set(['MIT', 'APACHE-2.0', 'BSD-2-CLAUSE', 'BSD-3-CLAUSE', 'ISC', 'UNLICENSE', '0BSD']);
const COPYLEFT = /^(GPL|AGPL|LGPL)/;

/**
 * Collapse rows into candidates and rank them.
 *
 * A project found on three surfaces is a stronger signal than three projects found
 * once. A flat list of hits cannot say that; this can, and it prints WHY.
 */
/**
 * How much of the take actually appears in this candidate.
 *
 * Without this the ranking is pure popularity: measured, a 1.1M/wk general agent
 * framework outranked a project literally described as "durable agent memory,
 * provenance, trust" because downloads swamped everything. Relevance has to be a
 * multiplier on the signal, not another additive term.
 */
function relevanceOf(query, c) {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
  if (terms.length === 0) return 1;
  const hay = `${c.name} ${c.details.join(' ')}`.toLowerCase();
  const hits = terms.filter((t) => hay.includes(t)).length;
  return hits / terms.length;
}

function converge(rows, priors, query = '') {
  const cands = new Map();
  for (const r of rows) {
    if (r.name === undefined || r.name === null) continue;
    const key = repoKey(r.url) ?? `${r.surface}:${r.name}`;
    const c = cands.get(key) ?? {
      key,
      name: repoKey(r.url) ?? r.name,
      surfaces: new Set(),
      urls: new Set(),
      details: [],
      stars: 0,
      downloads: 0,
      license: null,
      updated: '',
    };
    c.surfaces.add(r.surface);
    if (r.url) c.urls.add(r.url);
    if (r.detail) c.details.push(`${r.surface}: ${r.detail}`);
    if (typeof r.stars === 'number') c.stars = Math.max(c.stars, r.stars);
    if (typeof r.downloads === 'number') c.downloads = Math.max(c.downloads, r.downloads);
    if (r.license && !c.license) c.license = r.license;
    if (r.updated && r.updated > c.updated) c.updated = r.updated;
    cands.set(key, c);
  }

  const now = Date.now();
  for (const c of cands.values()) {
    const reasons = [];
    let score = 0;

    const conv = c.surfaces.size;
    if (conv > 1) {
      score += conv * 12;
      reasons.push(`${conv} surfaces agree`);
    }
    if (c.downloads > 0) {
      score += Math.log10(c.downloads + 1) * 8;
      if (c.downloads > 10000) reasons.push(`${c.downloads.toLocaleString()}/wk`);
    }
    if (c.stars > 0) score += Math.log10(c.stars + 1) * 4;

    // Freshness: an abandoned repo is a maintenance liability, not a donor.
    if (c.updated) {
      const age = now - Date.parse(c.updated);
      if (Number.isFinite(age)) {
        if (age < YEAR / 2) { score += 10; }
        else if (age > 2 * YEAR) { score -= 12; reasons.push(`STALE since ${c.updated}`); }
      }
    }

    if (c.license) {
      if (PERMISSIVE.has(c.license)) { score += 6; }
      else if (COPYLEFT.test(c.license)) { score -= 20; reasons.push(`${c.license} — IDEAS ONLY`); }
    } else {
      reasons.push('licence UNKNOWN');
    }

    // Mechanism surfaces mean somebody's code literally contains the thing.
    if (c.surfaces.has('code') || c.surfaces.has('ghcode')) {
      score += 8;
      reasons.push('code match');
    }
    if (c.surfaces.has('hn')) reasons.push('HN discussion — read for criticism');

    // Relevance sets READING ORDER. It does not gate.
    //
    // Discovery is a recall problem, not a precision problem: reading a bad candidate
    // costs seconds, missing a good one costs the idea. A project that solves your
    // problem in vocabulary you did not think of will always score low on term overlap
    // -- that is the lateral find, and burying it is the worst failure this tool has.
    // So relevance nudges the sort and NOTHING is ever hidden.
    const rel = relevanceOf(query, c);
    c.relevance = rel;
    score = score * (0.6 + 0.4 * rel);
    if (rel >= 0.99) reasons.push('matches the take fully');
    else if (rel <= 0.34) reasons.push(`lateral (${Math.round(rel * 100)}% term overlap) — read anyway`);

    const prior = priors.get(c.key.toLowerCase()) ?? priors.get(c.name.toLowerCase());
    if (prior !== undefined) {
      c.prior = prior;
      reasons.unshift(`ALREADY ${prior.verdict.toUpperCase()}: ${prior.why}`.trim());
      if (prior.verdict === 'rejected') score -= 40;
    }

    c.score = Math.round(score);
    c.reasons = reasons;
  }

  return [...cands.values()].sort((a, b) => b.score - a.score);
}

/** Fill in missing licences for anything GitHub-addressable. Feeds the Phase 3 gate. */
async function resolveLicenses(cands, cap = 12) {
  const need = cands.filter((c) => !c.license && /^[\w.-]+\/[\w.-]+$/.test(c.key)).slice(0, cap);
  await Promise.all(
    need.map(async (c) => {
      try {
        const out = await gh(['api', `repos/${c.key}/license`, '--jq', '.license.spdx_id']);
        const spdx = out.trim();
        if (spdx && spdx !== 'null' && spdx !== 'NOASSERTION') {
          c.license = spdx.toUpperCase();
          if (COPYLEFT.test(c.license)) {
            c.score -= 20;
            c.reasons.push(`${c.license} — IDEAS ONLY`);
          }
          c.reasons = c.reasons.filter((r) => r !== 'licence UNKNOWN');
        }
      } catch {
        /* private, missing, or rate-limited: leave UNKNOWN, which is honest */
      }
    }),
  );
}

/* ------------------------------------------------------------------- output */

function render(query, cands, empty, failed, top) {
  const shown = Math.min(top, cands.length);
  const out = [
    `SAUCE SCAN: "${query}"   ${cands.length} candidates found, showing ${shown}`,
    cands.length > shown ? `(raise --top to see all ${cands.length})` : '',
  ].filter(Boolean);
  for (const c of cands.slice(0, top)) {
    out.push('');
    const head = [`${String(c.score).padStart(4)}  ${c.name}`];
    if (c.license) head.push(`[${c.license}]`);
    if (c.updated) head.push(c.updated);
    out.push(head.join('  '));
    out.push(`      surfaces: ${[...c.surfaces].join(', ')}`);
    if (c.reasons.length > 0) out.push(`      why: ${c.reasons.join(' · ')}`);
    if (c.details[0]) out.push(`      ${c.details[0].slice(0, 130)}`);
    const url = [...c.urls][0];
    if (url) out.push(`      ${url}`);
  }
  if (empty.length > 0) out.push(`\nran, found NOTHING: ${empty.join(', ')}  <- empty niche or wrong synonym`);
  if (failed.length > 0) out.push(`unreachable: ${failed.join(', ')}`);
  return out.join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const get = (name, dflt) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? dflt : argv[i + 1];
  };
  const has = (name) => argv.includes(`--${name}`);

  if (has('remember')) {
    const donor = get('remember', '');
    const verdict = get('verdict', 'pending');
    const why = get('why', '');
    if (!donor) {
      process.stderr.write('--remember <donor> --verdict took|rejected|pending --why "<reason>"\n');
      process.exit(1);
    }
    const text = await remember(donor, verdict, why);
    process.stdout.write(`recorded: ${text}\n`);
    return;
  }

  const flagIdx = argv.findIndex((a) => a.startsWith('--'));
  const query = (flagIdx === -1 ? argv : argv.slice(0, flagIdx)).join(' ').trim();

  if (query.length === 0 || has('help')) {
    process.stdout.write(
      [
        'sauce-scan <query> [--surfaces a,b,c] [--limit N] [--top N] [--narrow] [--json]',
        'sauce-scan --remember <donor> --verdict took|rejected|pending --why "<reason>"',
        '',
        `surfaces: ${Object.keys(SURFACES).join(', ')}   (default: all)`,
        '',
        'Defaults are WIDE: --limit 15 per surface, --top 60, and the take is re-run at',
        'three phrasings automatically. Pass --narrow for a single pass.',
        'NOTHING is ever hidden by relevance -- it only sets reading order.',
        '',
        'code/ghcode = search the MECHANISM, not the project name. Two engines.',
        'hn          = the CRITICISM surface. What broke for somebody.',
        'npm/crates  = usage signal. Downloads beat stars.',
        'swh         = Software Heritage. Finds code deleted from its origin.',
        '',
        'Results are COLLAPSED per repo and ranked by convergence, usage, freshness',
        'and licence. Prior verdicts from --remember are surfaced automatically.',
        '',
        'Probed and dead: grep.app (429), libraries.io (401), godoc (retired),',
        'zenodo (HTML not JSON).',
      ].join('\n') + '\n',
    );
    return;
  }

  // Defaults are WIDE on purpose. A haul you can skim beats a shortlist you trust.
  const limit = Number(get('limit', 15)) || 15;
  const top = Number(get('top', 60)) || 60;
  const want = String(get('surfaces', Object.keys(SURFACES).join(','))).split(',');
  const chosen = want.filter((s) => s in SURFACES);

  // --wide re-runs every surface against narrower phrasings of the same take. Different
  // term counts hit different indexes; the union is strictly bigger than any one pass.
  const queries = has('narrow')
    ? [query]
    : [...new Set([query, headTerms(query, 2), headTerms(query, 1)])];

  const passes = [];
  for (const q of queries) passes.push(...chosen.map((s) => ({ s, q })));

  const [settled, priors] = await Promise.all([
    Promise.allSettled(passes.map((p) => SURFACES[p.s](p.q, limit))),
    loadPriors(),
  ]);

  const rows = [];
  const failed = [];
  const produced = new Set();
  for (let i = 0; i < settled.length; i += 1) {
    const r = settled[i];
    const { s } = passes[i];
    if (r.status !== 'fulfilled') {
      failed.push(`${s}(${String(r.reason?.message ?? 'error')})`);
      continue;
    }
    if (r.value.length > 0) produced.add(s);
    rows.push(...r.value);
  }
  const empty = chosen.filter((s) => !produced.has(s) && !failed.some((f) => f.startsWith(`${s}(`)));

  const cands = converge(rows, priors, query);
  if (!has('no-license')) await resolveLicenses(cands);
  cands.sort((a, b) => b.score - a.score);

  if (has('json')) {
    process.stdout.write(
      `${JSON.stringify(
        {
          query,
          candidates: cands.map((c) => ({ ...c, surfaces: [...c.surfaces], urls: [...c.urls] })),
          empty,
          failed,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  process.stdout.write(`${render(query, cands, empty, failed, top)}\n`);
}

main().catch((e) => {
  process.stderr.write(`sauce-scan failed: ${e?.message ?? String(e)}\n`);
  process.exit(1);
});
