# do-audit

**Open-source SEO audit CLI.** Full technical, on-page, keyword, authority and AI-search-visibility audits — straight from your terminal, producing a beautiful client-ready HTML report.

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
do-audit <domain>              # run a full audit
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

## What the audit covers

1. **Crawl** — robots.txt, sitemap, redirects, security headers, soft-404s, llms.txt, homepage + internal pages (titles, metas, canonicals, headings, schema, images, word counts)
2. **Performance** — Lighthouse mobile score and Core Web Vitals via PageSpeed Insights
3. **Research brief** — AI determines the business, brand, target market, competitors, keyword shortlist and visibility test prompts
4. **SEO data** *(with DataForSEO)* — ranked keywords, live SERP positions for site vs competitors, Google AI Overview presence and citations, backlink and traffic estimates
5. **AI visibility** — asks every AI platform you connected the same 5 buyer-style questions and measures whether the brand is mentioned or cited
6. **Analysis** — an AI auditor writes the report: health score, exhaustive technical and on-page issues with evidence and fixes, share-of-voice, and a prioritized action plan
7. **Report** — a self-contained HTML file you can send to anyone; optionally put your own brand name on it (`do-audit config set brand "My Agency"`)

## Privacy

do-audit has **no backend**. The only network calls it makes are to the site being audited and to the APIs *you* configured, directly from your machine. No telemetry, no analytics, no account.

## Requirements

- Node.js ≥ 18.17 (or Bun ≥ 1.0)

## License

[MIT](LICENSE)
