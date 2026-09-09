# sauce-scan

**Multi-surface discovery for finding working code. GitHub search is one population, not the population.**

GitHub repo search answers *"does a project exist for X."* It is bad at *"show me code
that does X"*, and it is blind to registries, archives, papers, and criticism. This hits
twelve surfaces, then does the part a search box never does: **collapses hits into ranked
candidates with printed reasons.**

```bash
node sauce-scan.mjs "<take>" --limit 6 --top 8
node sauce-scan.mjs "<symbol>" --surfaces code,ghcode     # mechanism search only
node sauce-scan.mjs "<take>" --json
```

Zero dependencies. Node 18+. `gh` CLI required for the GitHub surfaces.

## The twelve surfaces

Every one probe-verified reachable and keyless on 2026-09-09.

| surface | what it answers that the others cannot |
|---|---|
| `lists` | awesome-lists. **One fetch can beat two repo searches.** Try first. |
| `code` | Sourcegraph. Search the MECHANISM, not the project name. |
| `ghcode` | GitHub code search. Second mechanism engine, authenticated, different index. |
| `repo` | GitHub repos. Does a project exist? Stars, licence, last commit. |
| `npm` | **Usage signal.** Weekly downloads. Stars are vanity; downloads are production. |
| `crates` | Rust population, frequently disjoint from GitHub results. |
| `pypi` | Python. Exact-name lookup only — no keyless search API exists. |
| `hf` | Hugging Face models and **Spaces — Spaces are running code.** |
| `mcp` | Official MCP registry. Far more targeted than a GitHub topic. |
| `swh` | Software Heritage. **Finds code deleted from its origin.** Nothing else does. |
| `hn` | **The criticism surface.** Everything else reports what a project claims; HN reports what broke for somebody. |
| `papers` | OpenAlex + arXiv. Mechanisms before anyone has packaged them. |

### Probed and dead — documented so nobody re-discovers them

| | why |
|---|---|
| `grep.app` | HTTP 429 with an HTML error page under any headers. Blocks automation. Sourcegraph replaces it with better query syntax. |
| `libraries.io` | HTTP 401. Needs a key. |
| `godoc.org` | Retired. |
| `zenodo` | Returns HTML, not JSON. |

## It ranks, it does not just list

Hits are collapsed per repository and scored on **convergence** (how many surfaces
agree), usage, freshness, licence, and **relevance to the take** — then it prints why.
Licences are auto-resolved for anything GitHub-addressable. Stale repos and GPL/AGPL are
flagged, not silently ranked.

```
  20  openminion/sophiagraph  [APACHE-2.0]  2026-09-01
      surfaces: repo
      why: matches the take fully
```

**Relevance gates everything.** Measured: without it, a 1.1M/wk general agent framework
outranked a project literally described as *"durable agent memory, provenance, trust."*
Popularity is not fitness.

## omnithief — the all-out hunt

```bash
omnithief "<hunt>" --framings "<take>" --framings "<take>" --budget 15m
omnithief --ledger --tags eco:rust,dom:recovery     # query, ZERO network
omnithief --stats
```

Scans wide across many framings, labels everything deterministically, writes the **whole
haul to the loot ledger**, and returns two pages.

**The architecture solves one problem: a thousand candidates is unreadable and would cost
~100k tokens of context to hold.** So the haul never reaches your terminal. It goes to
the ledger — labelled, queryable, permanent — and you read a synthesis. Memory is the
answer to context.

**The framings are the intelligence.** Volume alone is noise. Volume across genuinely
different framings is where the unexpected steal lives:

| framing | example |
|---|---|
| the mechanism | `supervisor failure recovery` |
| the category | `multi agent orchestration` |
| the failure it prevents | `stalled worker timeout` |
| **the adjacent domain** | `process supervision restart watchdog` |

That last row is the one that pays. Supervision trees, circuit breakers and watchdogs
solved agent supervision decades before agents existed. Measured: the adjacent-domain
framing surfaced `heartbeat-rs`, `ogre-watchdog` and `procman` — none of which any
"agent" phrasing found.

### What comes back

`clusters` (how many schools of thought) · **`gaps`** (crowded vs sparse — *the sparse
ones are the opportunity*) · `convergent` · **`laterals`** (different vocabulary, same
problem) · `graveyard` (what was tried and abandoned) · `vocabulary` · `takeables`.

### Labels are COMPUTED, never inferred

Zero model calls. A thousand LLM labelling calls would cost an hour and blow the budget
the design exists to respect. Everything derives from metadata already in hand:
`lic:` `age:` `eco:` `dom:` `conv:` `fr:` `has:` `use:` `lateral`.

`fr:single-framing` is the sleeper — it flags a candidate that exactly one framing found,
which is how an adjacent-domain steal announces itself instead of being hoped for.

### Budget

Measured 2026-09-09: **404 candidates across 3 framings in 37 seconds.** The keyless
surfaces are generous (npm 250 rows/363ms; hf, hn, openalex, swh 200 each; a 12-call
burst throttled zero times). The only wall is `gh` search at **30 requests/minute**, and
that is per-TOKEN — so splitting across parallel workers does not raise it. Ten workers
share one bucket and all ten get refused. The budget spends it deliberately instead, and
**refuses a batch rather than overrunning your stated ceiling.**

## Loot memory

```bash
node sauce-scan.mjs --remember "<owner/repo>" --verdict took|rejected|pending --why "<reason>"
```

Verdicts persist via [apex-memory](https://github.com/omnibot007/apex-memory). A donor
you already rejected comes back flagged `ALREADY REJECTED: <why>` and sinks to the bottom
of the next ranking. The scan gets smarter every time you use it.

## Three things measured the hard way

**A vague take empties surfaces.** Run on its own problem domain, `"multi source code
search aggregator discovery"` emptied six of twelve surfaces and returned 33%-match
noise. Re-run as `"code search engine"` — a project *name* — and the top four came back
`matches the take fully`. Same tool, same minute. **A description is not a take.**

**Sort order lies.** A GitHub topic URL carrying `o=asc&s=stars` lists the *worst*-starred
repos first. That produced a survey of the bottom of a 3,514-repo topic before it was
caught.

**Zero results are data.** A surface that ran and found nothing prints
`ran, found NOTHING: ...`. Silence would be a lie by omission.

## Honest limits

- Two of twelve surfaces needed a correction the first time they met a real query
  (OpenAlex sorted by citations returned famous irrelevant papers; HN matched comment
  bodies and returned hiring megathreads). Assume a third will.
- `pypi` is exact-name lookup only. There is no keyless PyPI search API.
- Relevance is term overlap, not semantics. A project using entirely different
  vocabulary for the same mechanism will score low — which is exactly why `code` and
  `ghcode` exist.

## Licence

MIT.
