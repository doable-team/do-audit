// The audit pipeline: crawl → performance → SEO data → AI visibility →
// LLM analysis → HTML report. Every data source degrades gracefully when its
// key is missing; only one AI provider key is required.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fetchPage, techCheck, psi, ahrefsDR } from "./crawl.js";
import * as dfs from "./dataforseo.js";
import { brief, analyze } from "./analyze.js";
import { visibilityTests, configuredProviders, PROVIDERS, pool } from "./ai.js";
import { renderReport } from "./report.js";
import { Spinner, green, yellow, cyan, gray, bold, hr } from "./ui.js";

const uniqPages = (tech, home, max) => {
  const seen = new Set(["/", ""]);
  const out = [];
  const host = home?.finalUrl ? new URL(home.finalUrl).origin : null;
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

  // 3 — research brief (market, brand, competitors, keywords, AI prompts)
  sp.start("AI research brief (business, market, keywords, test prompts)…");
  d.brief = await brief(cfg, domain, d.home, d.tech, null, hasDFS);
  const iso = (opts.market || cfg.market || d.brief.market_iso || "US").toUpperCase();
  d.market = { iso, location_code: dfs.MARKETS[iso] || dfs.MARKETS.US,
    reason: opts.market || cfg.market ? "set by user" : d.brief.market_reason || "" };
  sp.ok(`Brief ready — market ${iso}, brand "${d.brief.brand_name || domain}"`);

  // 4 — SEO data (DataForSEO)
  if (hasDFS) {
    const loc = d.market.location_code, lang = "en";
    sp.start("Keyword rankings (DataForSEO)…");
    try {
      const ranked = await dfs.rankedKeywords(cfg, domain, loc, lang);
      if (ranked.length) {
        const seen = new Set();
        d.brief.shortlist = ranked
          .filter((k) => k.keyword && !seen.has(k.keyword) && seen.add(k.keyword))
          .slice(0, 10);
      }
      sp.ok(`${ranked.length} ranked keywords found`);
    } catch (e) { sp.warn("Ranked keywords skipped"); skip("ranked_keywords", e); }

    sp.start("Competitor discovery (DataForSEO)…");
    try {
      d.compCandidates = await dfs.competitors(cfg, domain, loc, lang);
      const top = d.compCandidates
        .filter((c) => c.domain && c.domain !== domain)
        .sort((a, b) => (b.intersections || 0) - (a.intersections || 0)).slice(0, 3);
      if (top.length) d.brief.competitors = top.map((c) => c.domain);
      sp.ok(`Competitors: ${(d.brief.competitors || []).join(", ") || "none found"}`);
    } catch (e) { sp.warn("Competitor discovery skipped"); skip("competitors", e); }

    const kws = (d.brief.shortlist || []).slice(0, 5).map((k) => k.keyword).filter(Boolean);
    sp.start(`Live SERP checks for ${kws.length} keywords…`);
    d.serpResults = (await pool(kws, 2, (kw) => dfs.serp(cfg, kw, loc, lang)))
      .filter((r) => r && !r.error);
    sp.ok(`${d.serpResults.length} SERPs analyzed (incl. AI Overview presence)`);

    sp.start("Backlinks & authority metrics…");
    try {
      d.siteBacklinks = await dfs.backlinksSummary(cfg, domain);
      d.siteRank = await dfs.rankOverview(cfg, domain, loc, lang);
      d.compData = (await pool((d.brief.competitors || []).slice(0, 3), 2, async (c) => ({
        ...(await dfs.backlinksSummary(cfg, c)),
        ...(await dfs.rankOverview(cfg, c, loc, lang)),
      }))).filter((r) => r && !r.error);
      sp.ok("Authority data collected for site + competitors");
    } catch (e) { sp.warn("Backlink data skipped"); skip("backlinks", e); }
  } else {
    warnings.push("DataForSEO key not set — keyword/SERP/competitor/backlink data skipped (run: do-audit init)");
    console.log(`  ${yellow("!")} ${gray("No DataForSEO key — skipping keywords, SERPs, competitors, backlinks")}`);
  }

  // 5 — Ahrefs DR
  if (cfg.keys?.ahrefs) {
    sp.start("Ahrefs domain rating…");
    d.dr = {};
    for (const dom of [domain, ...(d.brief.competitors || []).slice(0, 3)]) {
      try { d.dr[dom] = (await ahrefsDR(cfg, dom)).dr; } catch (e) { skip("ahrefs", e); }
    }
    sp.ok("Domain ratings collected");
  }

  // 6 — AI visibility across every configured provider
  const prompts = (d.brief.prompts || []).slice(0, 5);
  sp.start(`AI visibility: ${prompts.length} prompts × ${aiIds.length} platforms…`);
  d.aiResults = await visibilityTests(cfg, prompts, d.brief.brand_name || domain, domain,
    (done, total) => sp.update(`AI visibility: ${done}/${total} responses…`));
  const matrixMap = {};
  let mentions = 0, citations = 0;
  for (const r of d.aiResults) {
    matrixMap[r.prompt] = matrixMap[r.prompt] || {};
    matrixMap[r.prompt][r.platform] = r.mentioned;
    if (r.mentioned) mentions++;
    if (r.cited) citations++;
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
      return [p, rs.length ? Math.round((rs.filter((r) => r.mentioned).length / rs.length) * 100) : 0];
    })),
  };
  sp.ok(`AI visibility ${d.aiMetrics.visibility}% across ${platforms.length} platforms`);

  // 7 — analysis
  sp.start("Writing the audit (AI analysis — this can take a minute)…");
  d.analysis = await analyze(cfg, {
    domain, business: d.brief.business_summary, target_market: d.market,
    tech: d.tech, homepage: d.home, pages: d.pages, psi: d.psi,
    shortlist: d.brief.shortlist, serp: d.serpResults,
    site_metrics: { ...d.siteBacklinks, ...d.siteRank, dr: d.dr?.[domain] },
    competitors: (d.compData || []).map((c) => ({ ...c, dr: d.dr?.[c.domain] })),
    ai_metrics: d.aiMetrics,
    ai_responses: d.aiResults.map((r) => ({ platform: r.platform, prompt: r.prompt,
      excerpt: r.excerpt })),
    prior_assumptions: d.brief.assumptions || [],
  });
  sp.ok(`Analysis complete — health score ${d.analysis.score ?? "?"}/100`);

  // 8 — report
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
  console.log();

  if (opts.open) {
    const opener = process.platform === "darwin" ? "open"
      : process.platform === "win32" ? "start" : "xdg-open";
    spawn(opener, [outFile], { detached: true, stdio: "ignore", shell: process.platform === "win32" }).unref();
  }
  return { outFile, score: a.score };
}
