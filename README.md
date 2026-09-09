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
