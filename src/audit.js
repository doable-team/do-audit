// The audit pipeline, mirroring the proven step order of the original agent:
// crawl → performance → understand (LLM) → SEO data → strategy (main
// keywords + prompts) → SERP checks → competitor discovery FROM the main
// keywords' SERPs → authority →
// AI visibility (web-search enabled) → analysis → HTML report.
// Every data source degrades gracefully when its key is missing.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fetchPage, techCheck, psi, ahrefsDR } from "./crawl.js";
import * as dfs from "./dataforseo.js";
import { understand, strategy, analyze } from "./analyze.js";
import { normalizeBrief, normalizeAnalysis } from "./coerce.js";
import { llmResponsesDirect, serpCandidates, chatJSON, isNoiseDomain, configuredProviders, PROVIDERS, pool } from "./ai.js";
import { renderReport } from "./report.js";
import { renderNotes } from "./notes.js";
import { printTerminalReport } from "./termreport.js";
import { Spinner, yellow, cyan, gray, bold } from "./ui.js";

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


// Aggregate competitor candidates from live SERPs: which domains rank across
// the main keywords, how many keywords each covers, and at what positions.
export function serpCompetitorCandidates(serpResults, domain, limit = 8) {
  const stats = new Map();
  for (const r of serpResults || []) {
    const seen = new Set();
    for (const o of r.organic || []) {
      const h = String(o.domain || "").replace(/^www\./, "").toLowerCase();
      if (!h || h === domain || seen.has(h) || isNoiseDomain(h)) continue;
      seen.add(h);
      const st = stats.get(h) || { hits: 0, posSum: 0 };
      st.hits += 1;
      st.posSum += Number(o.pos) || 20;
      stats.set(h, st);
    }
  }
  return [...stats.entries()]
    .sort((a, b) => b[1].hits - a[1].hits || (a[1].posSum / a[1].hits) - (b[1].posSum / b[1].hits))
    .slice(0, limit)
    .map(([dom, st]) => ({ domain: dom, intersections: st.hits,
      avg_position: Math.round(st.posSum / st.hits) }));
}

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
    sp.start("SEO data: ranked keywords, backlinks (DataForSEO)…");
    d.compCandidates = [];
    try { d.ranked = await dfs.rankedKeywords(cfg, domain, loc, lang, 50); }
    catch (e) { d.ranked = []; skip("ranked_keywords", e); }
    try {
      d.siteBacklinks = await dfs.backlinksSummary(cfg, domain);
      d.siteRank = await dfs.rankOverview(cfg, domain, loc, lang);
    } catch (e) { skip("site_metrics", e); }
    sp.ok(`${(d.ranked || []).length} ranked keywords collected`);
  } else {
    d.ranked = []; d.compCandidates = [];
    warnings.push("DataForSEO key not set — keyword/SERP/competitor/backlink data skipped (run: do-audit init)");
    console.log(`  ${yellow("!")} ${gray("No DataForSEO key — skipping keywords, SERPs, competitors, backlinks")}`);
  }

  // 5 — strategy: the LLM curates competitors, shortlist and AI test prompts
  //     from the real data (true competitors only, mid/long-tail keywords).
  sp.start("SEO strategy: main keywords, competitors, test prompts (AI)…");
  const stratArgs = {
    business: d.brief.business_summary, brand: d.brief.brand_name,
    market: d.market, ranked: d.ranked, candidates: d.compCandidates,
  };
  let strat = await strategy(cfg, stratArgs);
  let merged = normalizeBrief({ ...d.brief, ...strat,
    assumptions: [...(d.brief.assumptions || []), ...(strat.assumptions || [])] });
  if (!merged.shortlist.length || !merged.prompts.length) {
    // The model returned an empty strategy (happens when it over-applies the
    // never-invent rule) — retry once with an explicit requirement.
    sp.update("SEO strategy returned empty — retrying with explicit requirements…");
    try {
      strat = await strategy(cfg, { ...stratArgs, force: true });
      merged = normalizeBrief({ ...d.brief, ...strat,
        assumptions: [...(d.brief.assumptions || []), ...(strat.assumptions || [])] });
    } catch (e) { skip("strategy retry", e); }
  }
  d.brief = merged;
  sp.ok(`${(d.brief.shortlist || []).length} main keywords · competitors: ${(d.brief.competitors || []).join(", ") || "none"}`);

  // Shared: the LLM picks up to 3 TRUE competitors from ranking candidates.
  const pickCompetitors = async (sourceLabel) => {
    try {
      const pick = await chatJSON(cfg,
        "You are an expert SEO strategist. Reply with strict JSON only. " +
        "Never invent data; base everything only on the evidence provided.",
        JSON.stringify({
          task: "These domains currently rank in top web results for the business's target keywords " +
            "(intersections = how many of the searched keywords each ranked for). Pick up to 3 TRUE " +
            "business competitors — real companies competing for the same customers; exclude " +
            "marketplaces, directories, review sites, media/publishers, social platforms and giant " +
            "generalists. Return {competitors:[domains], assumptions:[]}",
          business: d.brief.business_summary, brand: d.brief.brand_name, domain,
          ranking_candidates: d.compCandidates,
        }), 1000);
      const picked = normalizeBrief({ competitors: pick?.competitors }).competitors.slice(0, 3);
      if (picked.length) d.brief.competitors = picked;
      d.brief.assumptions.push(...normalizeBrief({ assumptions: pick?.assumptions }).assumptions);
    } catch (e) { skip("competitor pick", e); }
    sp.ok(`Competitors (${sourceLabel}): ${(d.brief.competitors || []).join(", ") || "none"}`);
  };

  // 5b — no-DataForSEO competitor grounding: search the researched keywords
  // live via a web-search-capable provider and pick from who actually ranks.
  // (With DataForSEO, grounding happens from the real SERPs in step 6b.)
  if (!hasDFS && !(d.compCandidates || []).length) {
    const kws = (d.brief.shortlist || []).slice(0, 5).map((k) => k.keyword).filter(Boolean);
    sp.start(`Competitor discovery via live search: ${kws.length} keywords…`);
    const { provider, candidates } = await serpCandidates(cfg, kws, domain,
      (done, total) => sp.update(`Competitor discovery via live search: ${done}/${total} keywords…`));
    if (candidates.length) {
      d.compCandidates = candidates;
      d.candidateSource = provider;
      await pickCompetitors(`from live top results via ${provider}`);
    } else if (provider) {
      sp.warn("Live-search competitor discovery found no candidates — keeping AI-suggested competitors");
    } else {
      sp.warn("No web-search-capable AI provider connected — competitors are AI-suggested, not ranking-verified");
      warnings.push("competitor discovery: no search-capable provider (connect Perplexity/OpenAI/Gemini for ranking-based discovery)");
    }
  }

  // 6 — live SERP checks for the FULL shortlist
  if (hasDFS) {
    const kws = (d.brief.shortlist || []).map((k) => k.keyword).filter(Boolean);
    sp.start(`Live SERP checks for ${kws.length} keywords…`);
    d.serpResults = (await pool(kws, 2, (kw) => dfs.serp(cfg, kw, loc, lang, 20)))
      .filter((r) => r && !r.error);
    sp.ok(`${d.serpResults.length} SERPs analyzed (incl. AI Overview presence)`);

    // 6b — competitor discovery FROM THE MAIN KEYWORDS: aggregate every
    // domain ranking across the 10 SERPs, rank by how many keywords each
    // covers (tie-break: better average position), then let the LLM pick the
    // true competitors from that list.
    if (d.serpResults.length) {
      d.compCandidates = serpCompetitorCandidates(d.serpResults, domain);
      d.candidateSource = "Google SERPs (DataForSEO)";
      if (d.compCandidates.length) {
        sp.start("Selecting top competitors ranking for the main keywords…");
        await pickCompetitors("top-ranking for the main keywords");
      }
    }

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

  // 11 — the result renders in the terminal; HTML is generated on demand
  // (interactive menu, or automatically with --out/--open/--json or piped).
  printTerminalReport(d, warnings);
  return { d, warnings };
}

// Write the designed HTML report + internal notes (+ raw JSON with opts.json).
export function saveReportFiles(cfg, d, warnings, opts = {}) {
  const outFile = path.resolve(opts.out ||
    `audit-${d.domain.replace(/[^a-z0-9.-]/gi, "_")}-${d.date}.html`);
  fs.writeFileSync(outFile, renderReport(cfg, d));
  d.reportFile = path.basename(outFile);
  const notesFile = outFile.replace(/\.html$/, "") + "-notes.html";
  fs.writeFileSync(notesFile, renderNotes(cfg, d, warnings));
  let jsonFile = null;
  if (opts.json) {
    jsonFile = outFile.replace(/\.html$/, "") + ".json";
    fs.writeFileSync(jsonFile, JSON.stringify({ ...d, warnings }, null, 2));
  }
  return { outFile, notesFile, jsonFile };
}

export function openInBrowser(target) {
  const opener = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "start" : "xdg-open";
  spawn(opener, [target], { detached: true, stdio: "ignore",
    shell: process.platform === "win32" }).unref();
}
