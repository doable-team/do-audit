// Self-contained HTML report in the visibility.so design system (ported from
// the site's design.md + global.css): Inter for UI, Instrument Serif (upright,
// no italics) for editorial headlines, warm monochrome palette (#F5F4EF surface, #1A1918
// ink, #E2DFD8 borders — no accent colors; amber #F59E0B only as the AI/agent
// indicator), 2rem card radii, pill nav, paper-grain noise overlay, sonar
// logo mark, dark grounding footer. Severity colors are functional data
// colors, kept warm and muted. Visibility.so promotion (banner + CTA) is
// UTM-tagged. An optional `brand` from the user's config replaces the logo.

import { normalizeBrief, normalizeAnalysis } from "./coerce.js";

const UTM = "utm_source=do-audit&utm_medium=report&utm_campaign=oss-cli";
const V_HOME = `https://visibility.so/?${UTM}`;
const V_REG = `https://app.visibility.so/register?${UTM}`;

export function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const fmt = (n) => (n == null || n === "" ? "—"
  : typeof n === "number" && Math.abs(n) >= 1000 ? n.toLocaleString("en-US") : String(n));

const asText = (t) => typeof t === "string" ? t
  : (t && typeof t === "object")
    ? (t.issue || t.title || t.action || t.text || t.description || Object.values(t).filter((v) => typeof v === "string").join(" — ") || "")
    : String(t ?? "");

const SEV_WORDS = { 1: "critical", 2: "high", 3: "medium", 4: "low" };
const sevWord = (s) => String(SEV_WORDS[s] ?? s ?? "").toLowerCase();
const sevClass = (s) => ({ critical: "crit", high: "warn", medium: "med" }[sevWord(s)] || "low");

function issueCard(x, showPage) {
  const sev = sevWord(x.severity);
  const urls = (x.affected_urls || []).slice(0, 10).map((u) =>
    `<li><a href="${esc(u.startsWith("http") ? u : "https://" + u)}" target="_blank" rel="noopener">${esc(u)}</a></li>`).join("");
  let ev = "";
  if (x.evidence) {
    const i = x.evidence.search(/https?:\/\//);
    ev = i >= 0
      ? `<span class="proof">${esc(x.evidence.slice(0, i).trim())} <a href="${esc(x.evidence.slice(i).trim())}" target="_blank" rel="noopener">view proof ↗</a></span>`
      : `<span class="proof">${esc(x.evidence)}</span>`;
  }
  return `<details class="issue ${sevClass(sev)}"${sev === "critical" || sev === "high" ? " open" : ""}>
    <summary><span class="pill ${sevClass(sev)}">${esc(sev.toUpperCase())}</span>
    <span class="issue-title">${esc(x.issue)}</span>
    ${showPage && x.page ? `<code class="issue-page">${esc(x.page)}</code>` : ""}
    <span class="chev"></span></summary>
    <div class="issue-body">${x.details ? `<p>${esc(x.details)}</p>` : ""}
    ${urls ? `<div class="affected"><span class="mini-label">Affected URLs</span><ul>${urls}</ul></div>` : ""}
    <div class="fixline"><span class="mini-label fix">Fix</span><p>${esc(x.recommendation || "")}</p>${ev}</div>
    </div></details>`;
}

function bar(label, pct, neutral) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const cls = neutral ? "neutral" : p < 25 ? "crit" : p < 50 ? "warn" : "good";
  return `<div class="bar-row"><div class="bar-top"><span>${esc(label)}</span><b class="${cls}-t">${p}%</b></div>
    <div class="bar-track"><div class="bar-fill ${cls}" data-w="${p}" style="width:${p}%"></div></div></div>`;
}

function donut(score) {
  const s = Math.max(0, Math.min(100, Number(score) || 0));
  const color = s < 50 ? "#B42318" : s < 75 ? "#F59E0B" : "#4A7C59";
  const circ = 2 * Math.PI * 62, fill = (circ * s) / 100;
  return `<div class="donut-wrap"><svg viewBox="0 0 150 150" class="donut">
    <circle cx="75" cy="75" r="62" fill="none" stroke="#E2DFD8" stroke-width="12"/>
    <circle class="donut-arc" cx="75" cy="75" r="62" fill="none" stroke="${color}" stroke-width="12"
      stroke-linecap="round" stroke-dasharray="${fill.toFixed(1)} ${circ.toFixed(1)}"
      data-fill="${fill.toFixed(1)} ${circ.toFixed(1)}" data-zero="0 ${circ.toFixed(1)}"
      transform="rotate(-90 75 75)"/></svg>
    <div class="donut-center"><span class="donut-num" data-count="${s}">${s}</span>
    <span class="donut-sub">Health Score</span></div></div>`;
}

const rankCell = (r, site) => r == null || r === 0
  ? (site ? `<td><span class="chip crit">Not ranking</span></td>` : `<td class="muted">—</td>`)
  : site
    ? `<td><span class="chip ${r > 10 ? "warn" : "good"}">#${r}</span></td>`
    : `<td class="num">#${r}</td>`;

function table(headers, rows, numCols = []) {
  return `<div class="tablewrap"><table><thead><tr>${headers
    .map((h, i) => `<th${numCols.includes(i) ? ' class="num"' : ""}>${esc(h)}</th>`).join("")}
    </tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function renderReport(cfg, d) {
  // Normalizing here too keeps the renderer safe even when called directly
  // (e.g. from a saved --json dump) with un-normalized model output.
  const a = normalizeAnalysis(d.analysis || {}), brief = normalizeBrief(d.brief || {});
  const site = d.domain, today = d.date;
  const brand = cfg.brand || "";
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const x of [...(a.technical_issues || []), ...(a.onpage_issues || [])]) {
    const s = sevWord(x.severity);
    if (s in counts) counts[s]++;
  }
  const shortlist = brief.shortlist || [];
  const compDomains = (brief.competitors || []).slice(0, 3);
  const serpRank = (kw, dom) => {
    const r = (d.serpResults || []).find((s) => s.keyword === kw);
    const hit = r?.organic?.find((o) => (o.domain || "").replace(/^www\./, "") === dom.replace(/^www\./, ""));
    return hit?.pos ?? null;
  };
  const ai = d.aiMetrics || {};
  const sovTotal = (a.sov || []).reduce((s, b) => s + (b.mentions || 0), 0) || 1;
  const platforms = Object.keys(ai.perPlatform || {});
  const hasKwData = shortlist.length > 0;
  const hasCompData = (d.compData || []).length > 0 || (d.compCandidates || []).length > 0;

  let n = 0;
  const sec = (id, eyebrow, body) =>
    `<section id="${id}" class="reveal"><div class="eyebrow"><span class="n">${String(++n).padStart(2, "0")}</span>${eyebrow}</div>${body}</section>`;

  const sections = [];
  sections.push(sec("summary", "Executive Summary",
    `<h2>Executive Summary</h2><p class="lead">${esc(a.executive_summary || "")}</p>
    ${(a.top_issues.length || a.quick_wins.length) ? `<div class="two-col">
      ${a.top_issues.length ? `<div class="panel"><h3>Top Priority Issues</h3><ol>${a.top_issues.map((t) => `<li>${esc(asText(t))}</li>`).join("")}</ol></div>` : ""}
      ${a.quick_wins.length ? `<div class="panel"><h3>Quick Wins</h3><ol>${a.quick_wins.map((t) => `<li>${esc(asText(t))}</li>`).join("")}</ol></div>` : ""}
    </div>` : ""}`));

  let cwv = "";
  if (d.psi && !d.psi.error) {
    cwv = `<h3>Core Web Vitals / Performance</h3>
      <p class="muted small">Lighthouse mobile score: ${d.psi.score ?? "—"}/100 ·
      <a href="${esc(d.psi.link)}" target="_blank" rel="noopener">verify on PageSpeed Insights ↗</a></p>
      ${table(["Metric", "Value"], ["LCP|" + d.psi.lcp, "CLS|" + d.psi.cls, "TBT|" + d.psi.tbt]
        .map((r) => { const [k, v] = r.split("|"); return `<tr><td><b>${k}</b></td><td class="num">${esc(v || "—")}</td></tr>`; }).join(""), [1])}`;
  }
  sections.push(sec("technical", "Technical Audit",
    `<h2>Technical SEO Issues</h2><p class="lead">${esc(a.technical_summary || "")}</p>
    ${(a.technical_issues || []).map((x) => issueCard(x)).join("")}${cwv}`));

  sections.push(sec("onpage", "On-Page Audit",
    `<h2>On-Page SEO Issues</h2><p class="lead">${esc(a.onpage_summary || "")}</p>
    ${(a.onpage_issues || []).map((x) => issueCard(x, true)).join("")}`));

  if (hasKwData) {
    sections.push(sec("keywords", "Keyword Intelligence",
      `<h2>Keyword Research &amp; Rankings</h2><p class="lead">${esc(a.keyword_summary || "")}</p>
      ${table(["Keyword", "Volume", "KD", site, ...compDomains],
        shortlist.map((k) => `<tr><td><b>${esc(k.keyword)}</b></td>
          <td class="num">${fmt(k.volume)}</td><td class="num">${fmt(k.difficulty)}</td>
          ${rankCell(serpRank(k.keyword, site) ?? k.rank, true)}
          ${compDomains.map((c) => rankCell(serpRank(k.keyword, c))).join("")}</tr>`).join(""), [1, 2])}
      <p class="muted small">Volume = monthly Google searches · KD = difficulty (0–100)${d.hasDataForSEO ? ` · Rank data: DataForSEO (live, ${today}, market: ${esc(d.market?.iso || "US")})` : " · No keyword data source configured — keywords are AI-suggested"}</p>`));
  }

  if (hasCompData) {
    sections.push(sec("competitors", "Competitive Landscape",
      `<h2>Competitor Research</h2><p class="lead">${esc(a.competitor_summary || "")}</p>
      ${table(["Competitor", "Shared KW", "Organic KW", "Est. Traffic/mo"],
        (d.compCandidates || []).filter((c) => compDomains.includes(c.domain))
          .map((c) => `<tr><td><b>${esc(c.domain)}</b></td><td class="num">${fmt(c.intersections)}</td>
          <td class="num">${fmt(c.organic_keywords)}</td><td class="num">${fmt(c.est_traffic)}</td></tr>`).join(""), [1, 2, 3])}`));

    const compRows = [
      { domain: site, ...(d.siteBacklinks || {}), ...(d.siteRank || {}), dr: d.dr?.[site], self: true },
      ...(d.compData || []).map((c) => ({ ...c, dr: d.dr?.[c.domain] })),
    ].map((c) => `<tr><td><b>${esc(c.domain)}</b>${c.self ? ' <span class="chip good" style="margin-left:6px">this site</span>' : ""}</td>
      <td class="num">${fmt(c.backlinks)}</td><td class="num">${fmt(c.referring_domains)}</td>
      <td class="num">${fmt(c.est_traffic)}</td><td class="num">${fmt(c.dr)}</td></tr>`).join("");
    sections.push(sec("comparison", "Authority Benchmark",
      `<h2>Domain Comparison</h2><p class="lead">${esc(a.comparison_summary || "")}</p>
      ${table(["Domain", "Backlinks", "Ref. Domains", "Est. Traffic/mo", "DR (Ahrefs)"], compRows, [1, 2, 3, 4])}
      <p class="muted small">Backlinks/traffic: DataForSEO${d.dr ? " · DR: Ahrefs APIv3" : ""}</p>`));
  }

  const aoRows = (d.serpResults || []).map((s) =>
    `<tr><td>${esc(s.keyword)}</td><td>${s.hasAIOverview ? "Yes" : "No"}</td>
    <td>${s.aiDomains?.some((x) => x.includes(site)) ? '<span class="chip good">Yes</span>'
      : s.hasAIOverview ? '<span class="chip warn">No</span>' : '<span class="muted">No</span>'}</td>
    <td>${esc((s.aiDomains || []).slice(0, 4).join(", "))}</td></tr>`).join("");
  sections.push(sec("ai", "AI Search Visibility",
    `<h2>AI Visibility</h2><p class="lead">${esc(a.ai_summary || "")}</p>
    <div class="disclaimer"><b>Methodology:</b> indicative scores based on ${(brief.prompts || []).length || 5} query
    fan-out test prompts run once per platform (${platforms.join(", ")}) on ${today}. AI answers vary by user,
    session and time — treat as a snapshot, not a benchmark.</div>
    <h3>AI Visibility Scores</h3><div class="bars">
    ${bar("AI Visibility Score", ai.visibility)}${bar("Citation Rate", ai.citationRate)}
    ${Object.entries(ai.perPlatform || {}).map(([p, v]) => bar("Visibility on " + p, v)).join("")}</div>
    ${(a.sov || []).length ? `<h3>Share of Voice — Brand vs Competitors</h3><div class="bars">
      ${a.sov.map((b) => bar(`${b.brand} · ${b.mentions} mentions`,
        Math.round(((b.mentions || 0) / sovTotal) * 100),
        !(b.brand || "").toLowerCase().includes(site.split(".")[0]))).join("")}</div>` : ""}
    <h3>Prompt × Platform Results (brand mentioned?)</h3>
    ${table(["Test Prompt", ...platforms], (ai.matrix || []).map((row) =>
      `<tr><td>${esc(row.prompt)}</td>${platforms.map((p) =>
        row.results?.[p] ? '<td class="yes">✓</td>' : '<td class="no">✗</td>').join("")}</tr>`).join(""))}
    ${aoRows ? `<h3>Google AI Overview Presence</h3>${table(["Keyword", "AI Overview Shown", site + " Cited", "Domains Cited"], aoRows)}` : ""}
    ${a.crawler_access ? `<h3>AI Crawler Access</h3><p>${esc(a.crawler_access)}</p>` : ""}`));

  sections.push(sec("plan", "Action Plan",
    `<h2>Recommendations &amp; Action Plan</h2>
    ${table(["Priority", "Action", "Expected Impact"], (a.recommendations || []).map((r) =>
      `<tr><td><span class="pill ${sevClass(r.priority)}">${esc(sevWord(r.priority).toUpperCase())}</span></td>
      <td><b>${esc(r.action)}</b></td><td>${esc(r.impact)}</td></tr>`).join(""))}`));

  // Visibility.so CTA — dark grounding card, per the design system
  sections.push(`<section id="next" class="reveal cta">
    <span class="cta-label"><span class="agent-dot"></span>Next Steps</span>
    <h2 class="cta-head">The future of SEO is <em>human&nbsp;+&nbsp;agentic</em></h2>
    <p class="cta-pitch">This audit is a snapshot — fixing it is a workflow. <b>Visibility.so</b> gives your team an SEO
    workspace where human strategists and AI agents work side by side: technical audits, content creation, link
    building and rank tracking, orchestrated in one place.</p>
    <div class="cta-actions">
      <a class="btn-light" href="${V_REG}&utm_content=cta" target="_blank" rel="noopener">Get started for free</a>
      <a class="btn-ghost" href="${V_HOME}&utm_content=cta-learn" target="_blank" rel="noopener">Learn more →</a>
    </div>
  </section>`);

  const navItems = [["summary", "Summary"], ["technical", "Technical"], ["onpage", "On-Page"],
    ...(hasKwData ? [["keywords", "Keywords"]] : []),
    ...(hasCompData ? [["competitors", "Competitors"], ["comparison", "Authority"]] : []),
    ["ai", "AI Visibility"], ["plan", "Action Plan"], ["next", "Next Steps"]];

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>SEO Audit Report — ${esc(site)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
<style>${CSS}</style><script>document.documentElement.classList.add('js')</script></head><body>
<div class="noise"></div>
<a class="promo" href="${V_HOME}&utm_content=banner" target="_blank" rel="noopener">
Powered by <b>visibility.so</b><span class="promo-sep">·</span>the SEO workspace for human + AI agent teams
<span class="promo-cta">Get started free →</span></a>
<div id="progress"></div>
<header class="hero"><div class="hero-in">
<div class="brandbar">
${brand ? `<span class="wordmark-custom">${esc(brand)}</span>` : LOGO}
<span class="brand-meta">SEO Audit · ${today}</span></div>
<div><div class="label">SEO Audit Report</div>
<h1 class="site">${esc(site)}</h1>
<p class="hero-sub">A complete technical, on-page, keyword, authority and <em>AI-search</em> analysis — with a prioritized plan to grow organic visibility.</p>
<div class="hero-tags">${["Technical SEO", "On-Page", "Keywords & Rankings", "Authority", "AI Visibility"]
  .map((t) => `<span class="tag">${t}</span>`).join("")}</div></div>
<div class="scorecard">${donut(a.score)}<div class="score-note">Overall SEO Health · ${today}</div></div>
</div></header>
<div class="strip">${[[counts.critical, "Critical Issues", "crit"], [counts.high, "High Issues", "warn"],
    [shortlist.length, "Keywords Analyzed", "info"], [ai.visibility ?? 0, "AI Visibility %", "med"]]
  .map(([v, l, cl]) => `<div class="stat"><div class="stat-num ${cl}" data-count="${v}">${v}</div><div class="stat-label">${l}</div></div>`).join("")}</div>
<nav class="pillnav-wrap"><div class="pillnav">${navItems.map(([i, t]) => `<a href="#${i}">${t}</a>`).join("")}</div></nav>
<main>${sections.join("")}</main>
<footer><div class="foot-in">
<span class="foot-brand">${LOGO_DARK}</span>
<span>${brand ? `Prepared by ${esc(brand)} · ` : ""}${today} ·
Generated with <a href="https://github.com/doable-team/do-audit" target="_blank" rel="noopener">do-audit</a> ·
Powered by <a href="${V_HOME}&utm_content=footer" target="_blank" rel="noopener">visibility.so</a></span>
</div></footer>
<script>${JS}</script></body></html>`;
}

// The Visibility.so sonar mark: center dot + 4 concentric arc rings (68% of
// each circumference), staggered pulse. Ported from the site's VisibilityLogo.
function sonarLogo(color, wordColor) {
  const rings = [[4.5, 19.23, 28.27, -4.52], [8, 34.18, 50.27, -8.04],
    [11.5, 49.13, 72.26, -11.56], [15, 64.09, 94.25, -15.08]];
  return `<span class="wordmark" style="color:${wordColor}">
<svg width="26" height="26" viewBox="0 0 34 34" fill="none" style="overflow:visible;flex-shrink:0">
<circle cx="17" cy="17" r="1.8" fill="${color}" style="animation:sonar 3s infinite 0s"/>
${rings.map(([r, L, P, off], i) =>
  `<circle cx="17" cy="17" r="${r}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round"
   stroke-dasharray="${L} ${P}" stroke-dashoffset="${off}" style="animation:sonar 3s infinite ${(0.2 * (i + 1)).toFixed(1)}s"/>`).join("")}
</svg><span class="wm-text">visibility<span class="wm-so">.so</span></span></span>`;
}
const LOGO = sonarLogo("#1A1918", "#1A1918");
const LOGO_DARK = sonarLogo("#FFFFFF", "#F5F4EF");

const CSS = `
:root{--surface:#F5F4EF;--elev:#FAF9F6;--white:#FFFFFF;--ink:#1A1918;--body2:#5A5855;--muted:#8E8B82;--line:#E2DFD8;--soft:#E8E6DF;
--amber:#F59E0B;--crit:#B42318;--critbg:#F5E5E1;--warn:#B45309;--warnbg:#FAEEDA;--med:#8A631B;--medbg:#F3ECDB;--good:#4A7C59;--goodbg:#E7EEE8;
--dark:#1A1918;--dark2:#242220;--darkline:#2E2C29;--ondark:#A09D96;--ondark2:#E2DFD8}
*{box-sizing:border-box;margin:0;padding:0}html{scroll-behavior:smooth;scroll-padding-top:84px}
body{font-family:'Inter',system-ui,sans-serif;background:var(--surface);color:var(--body2);font-size:15.5px;line-height:1.7;-webkit-font-smoothing:antialiased}
a{color:var(--ink);text-decoration:underline;text-underline-offset:3px;text-decoration-color:#C5C2BB;transition:text-decoration-color .2s}
a:hover{text-decoration-color:var(--ink)}b,strong{color:var(--ink)}
em{font-family:'Instrument Serif',Georgia,serif;font-style:normal;font-size:1.06em}
.noise{position:fixed;inset:0;pointer-events:none;z-index:9999;opacity:.03;
background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
@keyframes sonar{0%,100%{opacity:.2}50%{opacity:1}}
.wordmark{display:inline-flex;align-items:center;letter-spacing:-.02em;text-decoration:none}
.wm-text{font-size:21px;font-weight:500;margin-left:-6px;line-height:1}
.wm-so{font-weight:300}
.wordmark-custom{font-size:18px;font-weight:600;color:var(--ink);letter-spacing:-.01em}
.promo{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:7px;background:var(--dark);color:var(--ondark);
font-size:13px;font-weight:400;padding:10px 16px;text-align:center;text-decoration:none}
.promo b{color:#fff;font-weight:600}.promo-sep{color:#6B6862}
.promo-cta{color:var(--ondark2);font-weight:600;margin-left:6px;white-space:nowrap}
.promo:hover .promo-cta{color:#fff}
#progress{position:fixed;top:0;left:0;height:2px;width:0;z-index:100;background:var(--ink)}
.hero{position:relative;background:var(--surface)}
.hero-in{position:relative;max-width:1152px;margin:0 auto;padding:28px 24px 88px;display:grid;grid-template-columns:1.5fr 1fr;gap:48px;align-items:center}
@media(max-width:800px){.hero-in{grid-template-columns:1fr;padding-bottom:80px;text-align:center}}
.brandbar{grid-column:1/-1;display:flex;justify-content:space-between;align-items:center;margin-bottom:52px}
@media(max-width:800px){.brandbar{flex-direction:column;gap:12px}}
.brand-meta{font-size:12.5px;color:var(--muted)}
.label{font-size:11px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:var(--muted);margin-bottom:18px}
h1.site{font-family:'Instrument Serif',Georgia,serif;font-weight:400;font-size:clamp(40px,6vw,66px);line-height:1.02;letter-spacing:-.01em;color:var(--ink);margin-bottom:18px;word-break:break-word}
.hero-sub{color:var(--body2);max-width:520px;font-size:16.5px}@media(max-width:800px){.hero-sub{margin:0 auto}}
.hero-tags{display:flex;flex-wrap:wrap;gap:8px;margin-top:24px}@media(max-width:800px){.hero-tags{justify-content:center}}
.tag{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ink);background:var(--elev);border:1px solid var(--line);border-radius:100px;padding:7px 14px}
.scorecard{background:var(--white);border:1px solid var(--line);border-radius:2rem;padding:32px 28px;text-align:center;justify-self:center;transition:transform .25s}
.scorecard:hover{transform:translateY(-4px)}
.donut-wrap{position:relative;width:190px;margin:0 auto}
.donut-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}
.donut-num{font-size:46px;font-weight:600;color:var(--ink);letter-spacing:-.02em}
.donut-sub{font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.donut-arc{transition:stroke-dasharray 1.4s cubic-bezier(.22,.8,.35,1)}.score-note{margin-top:16px;font-size:12.5px;color:var(--muted)}
.strip{position:relative;z-index:5;max-width:1152px;margin:-48px auto 0;padding:0 24px 8px;display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
@media(max-width:760px){.strip{grid-template-columns:repeat(2,1fr)}}
.stat{background:var(--white);border:1px solid var(--line);border-radius:1.25rem;padding:20px 22px;display:flex;flex-direction:column;justify-content:center;gap:2px;min-height:104px;transition:transform .25s}
.stat:hover{transform:translateY(-3px)}
.stat-num{font-size:32px;font-weight:600;color:var(--ink);font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.stat-num.crit{color:var(--crit)}.stat-num.warn{color:var(--warn)}.stat-num.med{color:var(--med)}.stat-num.info{color:var(--ink)}
.stat-label{font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.pillnav-wrap{position:sticky;top:12px;z-index:60;display:flex;justify-content:center;padding:8px 12px;pointer-events:none}
.pillnav{pointer-events:auto;display:flex;gap:2px;overflow-x:auto;max-width:min(96vw,880px);background:rgba(250,249,246,.95);
-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border:1px solid var(--line);border-radius:100px;padding:5px;scrollbar-width:none;box-shadow:0 4px 20px rgba(26,25,24,.06)}
.pillnav::-webkit-scrollbar{display:none}
.pillnav a{color:var(--muted);padding:8px 14px;font-size:12.5px;font-weight:600;white-space:nowrap;border-radius:100px;text-decoration:none;transition:.18s}
.pillnav a:hover{color:var(--ink);background:var(--soft)}
.pillnav a.active{color:var(--ink);background:var(--soft)}
main{max-width:1152px;margin:0 auto;padding:16px 24px 48px}
section{background:var(--elev);border:1px solid var(--line);border-radius:2rem;padding:44px 48px;margin-top:28px}
@media(max-width:640px){section{padding:28px 22px;border-radius:1.25rem;margin-top:18px}}
html.js .reveal{opacity:0;transform:translateY(16px);transition:opacity .7s,transform .7s}
html.js .reveal.in{opacity:1;transform:none}
.eyebrow{display:flex;align-items:center;gap:12px;font-size:10.5px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:var(--muted);margin-bottom:14px}
.eyebrow .n{color:#C5C2BB}.eyebrow::after{content:"";flex:1;height:1px;background:var(--line)}
h2{font-family:'Instrument Serif',Georgia,serif;font-weight:500;color:var(--ink);font-size:clamp(26px,3.4vw,34px);letter-spacing:-.01em;margin-bottom:16px}
h3{color:var(--ink);font-size:16px;font-weight:600;margin:32px 0 12px}
.lead{font-size:16px;margin-bottom:16px;max-width:70ch}.small{font-size:12.5px}.muted{color:var(--muted)}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:22px}@media(max-width:640px){.two-col{grid-template-columns:1fr}}
.panel{background:var(--white);border:1px solid var(--line);border-radius:1rem;padding:22px 24px}
.panel h3{margin:0 0 12px;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:700}
.panel ol{padding-left:18px}.panel li{margin:8px 0;font-size:14.5px;color:var(--body2)}.panel li::marker{color:var(--muted);font-weight:600}
.pill{font-size:9.5px;font-weight:700;letter-spacing:.1em;padding:4px 11px;border-radius:100px;flex-shrink:0;text-transform:uppercase;border:1px solid transparent}
.pill.crit{background:var(--critbg);color:var(--crit)}.pill.warn{background:var(--warnbg);color:var(--warn)}.pill.med{background:var(--medbg);color:var(--med)}.pill.low{background:var(--soft);color:var(--muted)}
.chip{display:inline-block;font-size:11.5px;font-weight:600;padding:2px 10px;border-radius:100px}
.chip.crit{background:var(--critbg);color:var(--crit)}.chip.warn{background:var(--warnbg);color:var(--warn)}.chip.good{background:var(--goodbg);color:var(--good)}
.issue{position:relative;border:1px solid var(--line);border-radius:1rem;margin:12px 0;background:var(--white);overflow:hidden}
.issue::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--soft)}
.issue.crit::before{background:var(--crit)}.issue.warn::before{background:var(--warn)}.issue.med::before{background:var(--med)}.issue.low::before{background:#C5C2BB}
.issue:hover{border-color:#C5C2BB}
.issue summary{cursor:pointer;padding:15px 20px 15px 24px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;list-style:none}
.issue summary::-webkit-details-marker{display:none}
.issue-title{font-weight:600;color:var(--ink);font-size:15px;flex:1;min-width:200px}
.issue-page{font-family:Menlo,Consolas,monospace;font-size:11.5px;color:var(--ink);background:#EDEAE3;border:1px solid var(--line);border-radius:6px;padding:2px 8px}
.chev{width:8px;height:8px;border-right:1.5px solid var(--muted);border-bottom:1.5px solid var(--muted);transform:rotate(45deg);transition:transform .25s;margin-right:4px}
.issue[open] .chev{transform:rotate(-135deg)}
.issue-body{padding:2px 20px 18px 24px;border-top:1px dashed var(--line)}.issue-body>p{margin-top:12px;font-size:14.5px}
.mini-label{display:inline-block;font-size:9.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin:12px 0 4px}
.mini-label.fix{color:var(--good)}.affected ul{padding-left:20px;font-size:13.5px}.affected li{margin:3px 0}.affected li::marker{color:var(--muted)}
.fixline{display:flex;flex-direction:column}.fixline p{font-size:14.5px}.proof{font-size:12.5px;color:var(--muted);margin-top:6px}
.tablewrap{overflow-x:auto;margin:14px 0 6px;border:1px solid var(--line);border-radius:1rem;background:var(--white)}
table{border-collapse:collapse;width:100%;font-size:13.5px;min-width:560px}
th{color:var(--muted);text-align:left;padding:12px 16px;font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;border-bottom:2px solid var(--line);white-space:nowrap}
th.num{text-align:right}tbody td{padding:11px 16px;border-bottom:1px solid #EDEBE4;color:var(--body2)}
tbody tr:last-child td{border-bottom:none}tbody tr:hover{background:var(--elev)}
td.num{text-align:right;font-variant-numeric:tabular-nums}
td.yes{color:var(--good);font-weight:700;text-align:center;font-size:15px}
td.no{color:var(--warn);background:var(--warnbg);font-weight:700;text-align:center;font-size:15px}
.disclaimer{font-size:13px;background:var(--white);border:1px solid var(--line);border-left:3px solid var(--ink);border-radius:.75rem;padding:14px 18px;margin:6px 0 18px;color:var(--body2)}
.bars{margin:14px 0 4px;display:grid;gap:14px}
.bar-top{display:flex;justify-content:space-between;font-size:13.5px;font-weight:600;color:var(--ink);margin-bottom:5px}
.bar-track{background:var(--soft);height:8px;border-radius:100px;overflow:hidden}
.bar-fill{height:100%;border-radius:100px;transition:width 1.2s cubic-bezier(.22,.8,.35,1)}
.bar-fill.crit{background:var(--crit)}.bar-fill.warn{background:var(--amber)}
.bar-fill.good{background:var(--good)}.bar-fill.neutral{background:var(--ink)}
.crit-t{color:var(--crit)}.warn-t{color:var(--warn)}.good-t{color:var(--good)}.neutral-t{color:var(--ink)}
section.cta{position:relative;background:var(--dark);border-color:var(--dark);color:var(--ondark);text-align:center;padding:64px 48px}
.cta-label{display:inline-flex;align-items:center;gap:8px;font-size:10.5px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:var(--ondark);margin-bottom:18px}
.agent-dot{width:7px;height:7px;border-radius:50%;background:var(--amber);animation:sonar 3s infinite}
.cta-head{font-family:'Instrument Serif',Georgia,serif;font-weight:500;color:#fff;font-size:clamp(30px,4.4vw,46px);margin-bottom:16px}
.cta-head em{color:var(--ondark2)}
.cta-pitch{max-width:620px;margin:0 auto 32px;font-size:15px;color:var(--ondark)}.cta-pitch b{color:#fff}
.cta-actions{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.btn-light{background:var(--surface);color:var(--ink);font-weight:500;font-size:14px;border-radius:100px;padding:13px 28px;text-decoration:none;box-shadow:0 4px 14px rgba(0,0,0,.25);transition:.15s}
.btn-light:hover{background:var(--ondark2);text-decoration:none;transform:translateY(-1px)}
.btn-ghost{color:var(--ondark2);font-weight:500;font-size:14px;border:1px solid var(--darkline);border-radius:100px;padding:13px 28px;text-decoration:none;transition:.15s}
.btn-ghost:hover{border-color:#4A4744;color:#fff;text-decoration:none}
@media(max-width:640px){section.cta{padding:48px 24px}}
footer{background:var(--dark);margin-top:48px}
.foot-in{max-width:1152px;margin:0 auto;padding:36px 24px;display:flex;flex-wrap:wrap;gap:16px;align-items:center;justify-content:space-between;font-size:12.5px;color:var(--ondark)}
.foot-in a{color:var(--ondark2);text-decoration-color:#4A4744}.foot-in a:hover{color:#fff}
.foot-brand .wm-text{font-size:17px}
@media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}html.js .reveal{opacity:1;transform:none}}
`;

const JS = `
const bar=document.getElementById('progress');
addEventListener('scroll',()=>{const h=document.documentElement;bar.style.width=(h.scrollTop/(h.scrollHeight-h.clientHeight)*100)+'%';},{passive:true});
const motionOK=!matchMedia('(prefers-reduced-motion: reduce)').matches;
document.querySelectorAll('.bar-fill').forEach(b=>{if(motionOK){b.style.transition='none';b.style.width='0';void b.offsetWidth;b.style.transition='';}});
const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');
e.target.querySelectorAll('.bar-fill').forEach(b=>b.style.width=b.dataset.w+'%');io.unobserve(e.target);}}),{threshold:.12});
document.querySelectorAll('.reveal').forEach(el=>io.observe(el));
const arc=document.querySelector('.donut-arc');
if(arc&&motionOK){arc.style.transition='none';arc.setAttribute('stroke-dasharray',arc.dataset.zero);void arc.getBBox();
arc.style.transition='';setTimeout(()=>arc.setAttribute('stroke-dasharray',arc.dataset.fill),250);}
if(motionOK)document.querySelectorAll('[data-count]').forEach(el=>{const t=+el.dataset.count,d=1300,s=performance.now();
const step=n=>{const p=Math.min((n-s)/d,1);el.textContent=Math.round(t*(1-Math.pow(1-p,3)));
if(p<1)requestAnimationFrame(step);else el.textContent=t;};requestAnimationFrame(step);});
const links=[...document.querySelectorAll('nav a')];
const secs=links.map(a=>document.querySelector(a.hash)).filter(Boolean);
const nio=new IntersectionObserver(es=>{es.forEach(e=>{if(e.isIntersecting){links.forEach(l=>l.classList.toggle('active',l.hash==='#'+e.target.id));}})},{rootMargin:'-30% 0px -60% 0px'});
secs.forEach(s=>nio.observe(s));
`;
