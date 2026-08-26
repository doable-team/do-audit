// The audit pipeline, mirroring the proven step order of the original agent:
// crawl → performance → understand (LLM) → SEO data → strategy (LLM curates
// competitors/keywords/prompts from the real data) → SERP checks → authority →
// AI visibility (web-search enabled) → analysis → HTML report.
// Every data source degrades gracefully when its key is missing.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fetchPage, techCheck, psi, ahrefsDR } from "./crawl.js";
import * as dfs from "./dataforseo.js";
import { understand, strategy, analyze } from "./analyze.js";
import { normalizeBrief, normalizeAnalysis } from "./coerce.js";
import { llmResponsesDirect, configuredProviders, PROVIDERS, pool } from "./ai.js";
import { renderReport } from "./report.js";
import { Spinner, green, yellow, cyan, gray, bold, hr } from "./ui.js";

const uniqPages = (tech, home, max) => {
  const seen = new Set(["/", ""]);
  const out = [];
  const host = home?.finalUrl ? new URL(home.finalUrl).origin : null;
  // Sitemap URLs first (the agent's source), then internal links as fallback.
  const candidates = [...(tech.sitemapUrls || []), ...(home?.internalLinks || [])];
  for (const l of candidates) {
    let u;
    try { u = new URL(l, host || `https://${tech.domain}`); } catch { continue; }
    if (host && u.origin !== host) continue;
    const p = u.pathname.replace(/\/$/, "");
    if (seen.has(p) || /\.(xml|jpg|jpeg|png|gif|webp|svg|pdf|zip|css|js)$/i.test(p)) continue;
    seen.add(p);
    out.push(u.href);
    if (out.length >= max) break;
  }
  return out;
};

export async function runAudit(cfg, domain, opts = {}) {
  const sp = new Spinner();
  const warnings = [];
  const skip = (label, e) => warnings.push(`${label}: ${String(e.message || e).slice(0, 160)}`);
  const hasDFS = !!cfg.keys?.dataforseo;
  const aiIds = configuredProviders(cfg);
  const d = { domain, date: new Date().toISOString().slice(0, 10), hasDataForSEO: hasDFS };

  console.log(`\n  Auditing ${bold(cyan(domain))} ${gray("· AI: " + aiIds.map((i) => PROVIDERS[i].label).join(", "))}\n`);

  // 1 — crawl
  sp.start("Crawling site (robots, sitemap, homepage)…");
  d.tech = await techCheck(domain);
  d.home = await fetchPage(`https://${domain}/`);
  if (d.home?.error) {
    d.home = await fetchPage(`https://www.${domain}/`);
    if (d.home?.error) { sp.fail(`Could not fetch https://${domain}/ — ${d.home.error}`); throw new Error("site unreachable"); }
  }
  const extra = uniqPages(d.tech, d.home, opts.pages ?? 4);
  sp.update(`Crawling ${extra.length} internal pages…`);
  d.pages = (await pool(extra, 3, (u) => fetchPage(u))).filter((p) => p && !p.error);
  sp.ok(`Crawled homepage + ${d.pages.length} pages`);

  // 2 — performance
  sp.start("PageSpeed Insights (mobile Lighthouse)…");
  try { d.psi = await psi(cfg, d.home.finalUrl || `https://${domain}/`); }
  catch (e) { d.psi = { error: String(e.message || e) }; }
  if (d.psi?.error) { sp.warn(`PageSpeed skipped — ${d.psi.error}`); skip("psi", d.psi.error); }
  else sp.ok(`Performance score ${d.psi.score ?? "—"}/100 (mobile)`);

  // 3 — understand: business, brand, target market (from crawled pages only)
  sp.start("Understanding the business (AI)…");
  d.brief = await understand(cfg, d.home, d.pages);
  const iso = (opts.market || cfg.market || d.brief.market_country_iso || "US").toUpperCase();
  d.market = { iso, location_code: dfs.MARKETS[iso] || dfs.MARKETS.US,
    reason: opts.market || cfg.market ? "set by user" : d.brief.market_reason || "" };
  sp.ok(`Business understood — brand "${d.brief.brand_name || domain}", market ${iso}`);

  // 4 — SEO data (DataForSEO)
  const loc = d.market.location_code, lang = "en";
  if (hasDFS) {
    sp.start("SEO data: ranked keywords, competitors, backlinks (DataForSEO)…");
    try { d.ranked = await dfs.rankedKeywords(cfg, domain, loc, lang, 50); }
    catch (e) { d.ranked = []; skip("ranked_keywords", e); }
    try { d.compCandidates = await dfs.competitors(cfg, domain, loc, lang, 8); }
    catch (e) { d.compCandidates = []; skip("competitors", e); }
    try {
      d.siteBacklinks = await dfs.backlinksSummary(cfg, domain);
      d.siteRank = await dfs.rankOverview(cfg, domain, loc, lang);
    } catch (e) { skip("site_metrics", e); }
    sp.ok(`${(d.ranked || []).length} ranked keywords, ${(d.compCandidates || []).length} competitor candidates`);
  } else {
    d.ranked = []; d.compCandidates = [];
    warnings.push("DataForSEO key not set — keyword/SERP/competitor/backlink data skipped (run: do-audit init)");
    console.log(`  ${yellow("!")} ${gray("No DataForSEO key — skipping keywords, SERPs, competitors, backlinks")}`);
  }

  // 5 — strategy: the LLM curates competitors, shortlist and AI test prompts
  //     from the real data (true competitors only, mid/long-tail keywords).
  sp.start("SEO strategy: competitors, keyword shortlist, test prompts (AI)…");
  const strat = await strategy(cfg, {
    business: d.brief.business_summary, brand: d.brief.brand_name,
    market: d.market, ranked: d.ranked, candidates: d.compCandidates, hasData: hasDFS,
  });
  d.brief = normalizeBrief({ ...d.brief, ...strat,
    assumptions: [...(d.brief.assumptions || []), ...(strat.assumptions || [])] });
  sp.ok(`${(d.brief.shortlist || []).length} shortlist keywords · competitors: ${(d.brief.competitors || []).join(", ") || "none"}`);

  // 6 — live SERP checks for the FULL shortlist
  if (hasDFS) {
    const kws = (d.brief.shortlist || []).map((k) => k.keyword).filter(Boolean);
    sp.start(`Live SERP checks for ${kws.length} keywords…`);
    d.serpResults = (await pool(kws, 2, (kw) => dfs.serp(cfg, kw, loc, lang, 20)))
      .filter((r) => r && !r.error);
    sp.ok(`${d.serpResults.length} SERPs analyzed (incl. AI Overview presence)`);

    // 7 — authority: backlinks + rank overview for the chosen competitors
    sp.start("Authority data for competitors…");
    d.compData = (await pool((d.brief.competitors || []).slice(0, 3), 2, async (c) => ({
      domain: c,
      ...(await dfs.backlinksSummary(cfg, c).catch((e) => (skip(`bl ${c}`, e), {}))),
      ...(await dfs.rankOverview(cfg, c, loc, lang).catch((e) => (skip(`ro ${c}`, e), {}))),
    }))).filter(Boolean);
    sp.ok(`${d.compData.length} competitors profiled`);
  }

  // 8 — Ahrefs DR for site + competitors
  if (cfg.keys?.ahrefs) {
    sp.start("Ahrefs domain rating…");
    d.dr = {};
    for (const dom of [domain, ...(d.brief.competitors || []).slice(0, 3)]) {
      try { d.dr[dom] = (await ahrefsDR(cfg, dom)).dr; } catch (e) { skip(`dr ${dom}`, e); }
    }
    sp.ok("Domain ratings collected");
  }

  // 9 — AI visibility. Primary path (same as the original agent): DataForSEO's
  // AI Optimization API runs each prompt on ChatGPT (web search), Perplexity
  // and Gemini and returns answer text + cited URLs. Fallback when DataForSEO
  // is not connected: the user's own AI providers, called directly.
  const prompts = (d.brief.prompts || []).slice(0, 5);
  d.aiResults = [];
  if (hasDFS) {
    const combos = [];
    for (const p of prompts) for (const pr of dfs.AI_PROVIDERS) combos.push({ p, pr });
    sp.start(`AI visibility via DataForSEO: ${prompts.length} prompts × ${dfs.AI_PROVIDERS.length} platforms…`);
    let done = 0;
    const rs = await pool(combos, 3, async ({ p, pr }) => {
      const r = await dfs.llmResponse(cfg, p.prompt, pr.provider, pr.model, pr.web);
      sp.update(`AI visibility: ${++done}/${combos.length} responses…`);
      return { prompt: p.prompt, category: p.category, platform: pr.label,
        response: r.response, cited: r.cited };
    });
    for (const r of rs) if (r?.error) skip("ai_visibility", r.error);
    d.aiResults = rs.filter((r) => r && !r.error);
  }
  if (!d.aiResults.length) {
    // No DataForSEO (or its AI Optimization API unavailable) — direct fallback.
    sp.start(`AI visibility (direct): ${prompts.length} prompts × ${aiIds.length} providers…`);
    d.aiResults = await llmResponsesDirect(cfg, prompts,
      (done, total) => sp.update(`AI visibility: ${done}/${total} responses…`));
  }
  // Scoring — identical to the agent: a hit is the brand name OR the domain in
  // the answer text, or a cited URL on the domain.
  const brand = String(d.brief.brand_name || domain.split(".")[0]);
  const mention = (t) => t && (t.toLowerCase().includes(brand.toLowerCase()) ||
    t.toLowerCase().includes(domain));
  const matrixMap = {};
  let mentions = 0, citations = 0;
  for (const r of d.aiResults) {
    matrixMap[r.prompt] = matrixMap[r.prompt] || {};
    const hit = mention(r.response);
    const cited = (r.cited || []).some((u) => u.includes(domain));
    matrixMap[r.prompt][r.platform] = hit || cited;
    if (hit || cited) mentions++;
    if (cited) citations++;
  }
  const total = d.aiResults.length || 1;
  const platforms = [...new Set(d.aiResults.map((r) => r.platform))];
  d.aiMetrics = {
    total,
    visibility: Math.round((mentions / total) * 100),
    citationRate: Math.round((citations / total) * 100),
    matrix: Object.entries(matrixMap).map(([prompt, results]) => ({ prompt, results })),
    perPlatform: Object.fromEntries(platforms.map((p) => {
      const rs = d.aiResults.filter((r) => r.platform === p);
      const hits = rs.filter((r) => matrixMap[r.prompt]?.[p]).length;
      return [p, rs.length ? Math.round((hits / rs.length) * 100) : 0];
    })),
  };
  sp.ok(`AI visibility ${d.aiMetrics.visibility}% across ${platforms.length} platforms`);

  // 10 — analysis
  sp.start("Writing the audit (AI analysis — this can take a minute)…");
  d.analysis = normalizeAnalysis(await analyze(cfg, {
    domain, business: d.brief.business_summary, target_market: d.market,
    tech: d.tech, homepage: d.home, pages: d.pages, psi: d.psi,
    shortlist: d.brief.shortlist, serp: d.serpResults,
    site_metrics: { ...d.siteBacklinks, ...d.siteRank, dr: d.dr?.[domain] },
    competitors: (d.compData || []).map((c) => ({ ...c, dr: d.dr?.[c.domain] })),
    ai_metrics: d.aiMetrics,
    ai_responses: d.aiResults.map((r) => ({ platform: r.platform, prompt: r.prompt,
      excerpt: (r.response || "").slice(0, 500) })),
    prior_assumptions: d.brief.assumptions || [],
  }));
  sp.ok(`Analysis complete — health score ${d.analysis.score ?? "?"}/100`);

  // 11 — report
  const outFile = path.resolve(opts.out || `audit-${domain.replace(/[^a-z0-9.-]/gi, "_")}-${d.date}.html`);
  fs.writeFileSync(outFile, renderReport(cfg, d));
  if (opts.json) {
    const jsonFile = outFile.replace(/\.html$/, "") + ".json";
    fs.writeFileSync(jsonFile, JSON.stringify({ ...d, warnings }, null, 2));
    console.log(`  ${green("✓")} Raw data: ${cyan(jsonFile)}`);
  }

  hr();
  const a = d.analysis, cnt = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const x of [...(a.technical_issues || []), ...(a.onpage_issues || [])]) {
    const s = String(x.severity || "").toLowerCase();
    if (s in cnt) cnt[s]++;
  }
  console.log(`
  ${bold("Health score:")} ${a.score >= 75 ? green(a.score + "/100") : a.score >= 50 ? yellow(a.score + "/100") : bold(a.score + "/100")}
  ${bold("Issues:")} ${cnt.critical} critical · ${cnt.high} high · ${cnt.medium} medium · ${cnt.low} low
  ${bold("AI visibility:")} ${d.aiMetrics.visibility}% (${platforms.join(", ")})
  ${bold("Report:")} ${cyan(outFile)}`);
  if (warnings.length) {
    console.log(`\n  ${yellow("Warnings")} ${gray("(data that could not be collected)")}`);
    for (const w of warnings) console.log(gray("  · " + w));
  }
  console.log(`\n  ${gray("Fixing this is a workflow —")} ${bold("Visibility.so")} ${gray("runs SEO with human + AI agent teams:")}
  ${cyan("https://visibility.so/?utm_source=do-audit&utm_medium=cli&utm_campaign=oss-cli")}\n`);

  if (opts.open) {
    const opener = process.platform === "darwin" ? "open"
      : process.platform === "win32" ? "start" : "xdg-open";
    spawn(opener, [outFile], { detached: true, stdio: "ignore", shell: process.platform === "win32" }).unref();
  }
  return { outFile, score: a.score };
}
