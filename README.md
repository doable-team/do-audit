# do-audit

**Open-source SEO audit CLI.** Full technical, on-page, keyword, authority and AI-search-visibility audits — straight from your terminal, producing a beautiful client-ready HTML report.

> Built by the team behind **[Visibility.so](https://visibility.so/?utm_source=do-audit&utm_medium=readme&utm_campaign=oss-cli)** — the SEO workspace where human strategists and AI agents run audits, content, links and rank tracking together. [Get started for free →](https://app.visibility.so/register?utm_source=do-audit&utm_medium=readme&utm_campaign=oss-cli)

- 🔑 **Bring your own keys** — you connect your own API keys during onboarding; nothing is proxied
- 💻 **100% local** — no backend, no accounts, no telemetry; your data never leaves your machine
- 🤖 **AI-visibility testing across 8 platforms** — ChatGPT, Claude, Gemini, Perplexity, DeepSeek, Groq, Grok, OpenRouter
- 📊 **Real SEO data** — keywords, live SERPs, AI Overviews, competitors and backlinks via DataForSEO; Core Web Vitals via PageSpeed; DR via Ahrefs
- 📄 **Client-ready report** — a polished, self-contained HTML report with health score, exhaustive issue lists, evidence links and an action plan
- 🪶 **Zero dependencies** — plain Node ≥ 18, installs in seconds

## Install

```bash
# npm
npm install -g do-audit

# bun
bun add -g do-audit

# or run without installing
npx do-audit example.com
```

## Quick start

```bash
# 1. Connect your API keys (interactive, one-time)
do-audit init

# 2. Run an audit
do-audit example.com --open
```

That's it. The report lands in your current directory as `audit-example.com-<date>.html`.

```
  do-audit v0.1.0
  Open-source SEO audit — technical · on-page · keywords · authority · AI visibility

  Auditing example.com · AI: ChatGPT (OpenAI), Perplexity

  ✓ Crawled homepage + 4 pages
  ✓ Performance score 87/100 (mobile)
  ✓ Brief ready — market US, brand "Example"
  ✓ 42 ranked keywords found
  ✓ Competitors: rival-a.com, rival-b.com, rival-c.com
  ✓ 5 SERPs analyzed (incl. AI Overview presence)
  ✓ Authority data collected for site + competitors
  ✓ AI visibility 40% across 2 platforms
  ✓ Analysis complete — health score 71/100

  Health score:  71/100
  Issues:        2 critical · 5 high · 9 medium · 4 low
  Report:        ./audit-example.com-2026-08-26.html
```

## API keys

You bring your own keys — `do-audit init` walks you through connecting them with an arrow-key menu (↑/↓ + Enter): pick a provider, paste the key, optionally set a custom model. Only **one AI provider** is required — the data integrations can be skipped in one step for an AI-only audit.

| Key | Used for | Required | Get it |
| --- | --- | --- | --- |
| OpenAI / Anthropic / Gemini / Perplexity / OpenRouter / DeepSeek / Groq / xAI | Audit analysis + AI-visibility testing (each connected platform is tested) | ≥ 1 of them | linked during `init` |
| DataForSEO (`login:password`) | Keywords, live SERPs & AI Overviews, competitors, backlinks | optional | [dataforseo.com](https://dataforseo.com) |
| Google API key | Lifts PageSpeed Insights rate limits (PSI works without it) | optional | [PSI get-started](https://developers.google.com/speed/docs/insights/v5/get-started) |
| Ahrefs | Free domain-rating endpoint | optional | [ahrefs.com/api](https://ahrefs.com/api) |

Keys are stored locally in `~/.config/do-audit/config.json` (mode `0600`). Environment variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DATAFORSEO_KEY`, …) override the stored config — handy for CI.

## Commands

```bash
do-audit <domain>              # run a full audit (report + internal notes)
do-audit edit [report.html]    # edit a report visually in your browser
do-audit init                  # connect / update API keys (interactive)
do-audit config                # show configuration status (keys are masked)
do-audit config set <k> <v>    # set a value non-interactively, e.g.:
                               #   do-audit config set keys.openai sk-…
                               #   do-audit config set brand "My Agency"
do-audit config path           # print the config file location
```

### Flags

| Flag | Meaning |
| --- | --- |
| `--open` | Open the HTML report in your browser when done |
| `--out <file>` | Report output path (default `./audit-<domain>-<date>.html`) |
| `--market <ISO>` | Target market, e.g. `US`, `GB`, `IN` (default: auto-detected from the site) |
| `--pages <n>` | Extra internal pages to crawl (default 4) |
| `--json` | Also write all collected raw data as JSON |
| `--agent` | Machine mode — audit JSON on stdout, progress on stderr, no files, never prompts |
| `--full` | With `--agent`, also include the complete raw data set under `raw` |

## Use it from Claude Code (or any AI agent)

`--agent` turns do-audit into a tool an AI agent can call: **stdout carries nothing but JSON**, every
progress line goes to stderr, no files are written, nothing ever prompts, and the exit code is
non-zero on failure.

```bash
do-audit example.com --agent            # full audit as JSON on stdout
do-audit example.com --agent | jq .score
do-audit example.com --agent --out report.html   # JSON *and* the HTML report
```

So you can just say:

> *"Run an SEO audit for example.com with do-audit and summarise the report."*

and the agent runs `do-audit example.com --agent`, parses stdout and writes the summary.

The payload is a curated projection built for context windows — raw HTML, internal-link lists and
full SERP tables are summarized out (add `--full` for everything):

```jsonc
{
  "ok": true, "domain": "example.com", "date": "2026-08-27", "score": 71,
  "executive_summary": "…",
  "business":        { "brand": "Example", "summary": "…", "market": "US" },
  "issues":          { "counts": { "critical": 2, "high": 5, "medium": 9, "low": 4, "total": 20 },
                       "top": ["…"], "quick_wins": ["…"],
                       "technical": [{ "issue": "…", "severity": "high", "recommendation": "…", "evidence": "…" }],
                       "onpage":    [{ "issue": "…", "severity": "medium", "page": "/pricing" }] },
  "recommendations": [{ "priority": "critical", "action": "…", "impact": "…" }],
  "performance":     { "score": 64, "lcp": "3.1 s", "cls": "0.02", "tbt": "420 ms" },
  "technical":       { "robots": {…}, "sitemap": {…}, "llms_txt": false, "blocked_ai_bots": ["GPTBot"] },
  "crawl":           { "pages_crawled": 5, "pages": [{ "url": "…", "title_length": 58, "word_count": 820 }] },
  "keywords":        [{ "keyword": "…", "volume": 1200, "difficulty": 34, "rank": 12 }],
  "serps":           [{ "keyword": "…", "has_ai_overview": true, "site_position": 12, "top_3": […] }],
  "competitors":     { "picked": ["rival.com"], "source": "Google SERPs (DataForSEO)", "profiles": […] },
  "authority":       { "backlinks": 400, "referring_domains": 60, "domain_rating": 21 },
  "ai_visibility":   { "visibility_pct": 30, "citation_rate_pct": 10, "per_platform": {…}, "matrix": […] },
  "summaries":       { "technical": "…", "keyword": "…", "ai": "…" },
  "assumptions": ["…"], "warnings": ["psi: rate limited"],
  "data_sources":    { "dataforseo": true, "pagespeed": true, "ahrefs": true }
}
```

On failure it prints `{"ok": false, "error": "…"}` and exits 1 — including when no API key is
configured, so an agent gets a clear message instead of hanging on the onboarding prompt. In CI or
agent sandboxes, pass the keys as environment variables (`OPENAI_API_KEY`, `DEEPSEEK_API_KEY`,
`DATAFORSEO_KEY`, …) instead of running `do-audit init`.

`warnings` is the honest part of the payload: any step that degraded (missing key, API error) is
listed there, and the corresponding fields are `null` rather than zero.

### As a library

```js
import { loadConfig, runAudit, buildSummary } from "do-audit";

const { d, warnings } = await runAudit(loadConfig(), "example.com");
const summary = buildSummary(d, warnings, { version: "0.10.0" });
```

## What the audit covers

1. **Crawl** — robots.txt, sitemap, redirects, security headers, soft-404s, llms.txt, homepage + internal pages (titles, metas, canonicals, headings, schema, images, word counts)
2. **Performance** — Lighthouse mobile score and Core Web Vitals via PageSpeed Insights
3. **Research brief** — AI determines the business, brand, target market, competitors and visibility test prompts
4. **Keyword research** — the business's **main keywords** (derived from its services, products and market — the terms customers actually search), then checks which of them the site ranks for via live SERPs; volume/difficulty shown where ranking data exists *(with DataForSEO — plus AI Overview presence/citations, backlink and traffic estimates)*
5. **AI visibility** — runs 5 buyer-style test prompts on ChatGPT (with web search), Perplexity and Gemini via DataForSEO's AI Optimization API and measures whether the brand is mentioned or cited; without DataForSEO it falls back to asking your own connected AI providers directly
6. **Analysis** — an AI auditor writes the report: health score, exhaustive technical and on-page issues with evidence and fixes, share-of-voice, and a prioritized action plan
7. **Report** — a self-contained HTML file you can send to anyone; optionally put your own brand name on it (`do-audit config set brand "My Agency"`). An internal `…-notes.html` lands next to it with the AI's assumptions to verify, the market reasoning, and any pipeline warnings — check it before sending the report.

## Editing reports

`do-audit edit report.html` (or just `do-audit edit` for the newest report in the folder) opens the report in your browser with a full visual editor — no HTML knowledge needed:

- Click any text to edit in place; rich-text toolbar (bold/italic/size/color, headings, lists, alignment, links)
- Add, drag-to-reorder, or delete whole sections; insert tables and images (uploads are compressed and embedded)
- **Version history**: every save snapshots the previous version — preview and restore any of the last 20, or reset to the original AI-generated report
- Runs on a localhost-only server (127.0.0.1); Save writes directly back to the file, versions live in `report.html.versions/`

## Privacy

do-audit has **no backend**. The only network calls it makes are to the site being audited and to the APIs *you* configured, directly from your machine. No telemetry, no analytics, no account.

## Requirements

- Node.js ≥ 18.17 (or Bun ≥ 1.0)

## License

[MIT](LICENSE)
