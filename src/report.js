// Self-contained HTML report. Neutral branding: an optional `brand` from the
// user's config appears in the header/footer; otherwise the report is unbranded.
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
    const i = x.evidence.indexOf("http");
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
  const color = s < 50 ? "#ff6b6b" : s < 75 ? "#ffb03a" : "#3ddc97";
  const circ = 2 * Math.PI * 62, fill = (circ * s) / 100;
  return `<div class="donut-wrap"><svg viewBox="0 0 150 150" class="donut">
    <circle cx="75" cy="75" r="62" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="12"/>
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
  const a = d.analysis || {}, brief = d.brief || {};
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
    ${(a.top_issues || a.quick_wins) ? `<div class="two-col">
      ${a.top_issues ? `<div class="panel"><h3>Top Priority Issues</h3><ol>${a.top_issues.map((t) => `<li>${esc(asText(t))}</li>`).join("")}</ol></div>` : ""}
      ${a.quick_wins ? `<div class="panel"><h3>Quick Wins</h3><ol>${a.quick_wins.map((t) => `<li>${esc(asText(t))}</li>`).join("")}</ol></div>` : ""}
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

  const navItems = [["summary", "Summary"], ["technical", "Technical"], ["onpage", "On-Page"],
    ...(hasKwData ? [["keywords", "Keywords"]] : []),
    ...(hasCompData ? [["competitors", "Competitors"], ["comparison", "Authority"]] : []),
    ["ai", "AI Visibility"], ["plan", "Action Plan"]];

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>SEO Audit Report — ${esc(site)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;700;800&display=swap" rel="stylesheet">
<style>${CSS}</style><script>document.documentElement.classList.add('js')</script></head><body>
<div id="progress"></div>
<header class="hero"><div class="hero-in">
<div class="brandbar"><span class="brand-name">${esc(brand || "SEO Audit")}</span>
<span class="brand-meta">SEO Audit · ${today}</span></div>
<div><div class="overline">SEO Audit Report</div>
<h1 class="site"><span class="grad">${esc(site)}</span></h1>
<p class="hero-sub">A complete technical, on-page, keyword, authority and AI-search analysis — with a prioritized plan to grow organic visibility.</p>
<div class="hero-tags">${["Technical SEO", "On-Page", "Keywords & Rankings", "Authority", "AI Visibility"]
  .map((t) => `<span class="tag">${t}</span>`).join("")}</div></div>
<div class="scorecard">${donut(a.score)}<div class="score-note">Overall SEO Health · ${today}</div></div>
</div></header>
<div class="strip">${[[counts.critical, "Critical Issues", "crit"], [counts.high, "High Issues", "warn"],
    [shortlist.length, "Keywords Analyzed", "info"], [ai.visibility ?? 0, "AI Visibility %", "med"]]
  .map(([v, l, cl]) => `<div class="stat"><div class="stat-num ${cl}" data-count="${v}">${v}</div><div class="stat-label">${l}</div></div>`).join("")}</div>
<nav>${navItems.map(([i, t]) => `<a href="#${i}">${t}</a>`).join("")}</nav>
<main>${sections.join("")}</main>
<footer>${brand ? `Prepared by ${esc(brand)} · ` : ""}${today} · Generated with <a href="https://github.com/doable-team/do-audit" target="_blank" rel="noopener">do-audit</a> — the open-source SEO audit CLI</footer>
<script>${JS}</script></body></html>`;
}

const CSS = `
:root{--deep:#040b26;--navy:#0a1745;--ink:#101f4d;--body:#43537d;--muted:#8593b6;--line:#e5eaf6;--line2:#eef2fa;--blue:#0094ff;--sky:#4cc2ff;--accent:#0b5394;--crit:#d92d20;--critbg:#fdeceb;--warn:#e8760c;--warnbg:#fdf1e4;--med:#b45309;--medbg:#fdf6e3;--good:#0e9273;--goodbg:#e5f5f0;--bg:#f6f8fd;--card:#fff;--r:18px;--shadow:0 1px 2px rgba(16,31,77,.04),0 8px 28px rgba(16,31,77,.07)}
*{box-sizing:border-box;margin:0;padding:0}html{scroll-behavior:smooth;scroll-padding-top:70px}
body{font-family:'Manrope',system-ui,sans-serif;background:var(--bg);color:var(--body);font-size:15.5px;line-height:1.7;-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}b,strong{color:var(--ink)}
#progress{position:fixed;top:0;left:0;height:3px;width:0;z-index:100;background:linear-gradient(90deg,var(--blue),var(--sky))}
.hero{position:relative;overflow:hidden;color:#fff;background:var(--deep)}
.hero::before{content:"";position:absolute;inset:0;background:radial-gradient(900px 500px at 82% -10%,#0f4fd826,transparent 60%),radial-gradient(700px 420px at 8% 108%,#0094ff21,transparent 55%),linear-gradient(160deg,#0a1c55,#040b26 70%)}
.hero::after{content:"";position:absolute;inset:0;opacity:.5;background-image:linear-gradient(#ffffff08 1px,transparent 1px),linear-gradient(90deg,#ffffff08 1px,transparent 1px);background-size:56px 56px;mask-image:radial-gradient(800px 500px at 50% 30%,#000 30%,transparent 75%)}
.hero-in{position:relative;z-index:2;max-width:1020px;margin:0 auto;padding:36px 20px 104px;display:grid;grid-template-columns:1.5fr 1fr;gap:40px;align-items:center}
@media(max-width:800px){.hero-in{grid-template-columns:1fr;padding-bottom:96px;text-align:center}}
.brandbar{grid-column:1/-1;display:flex;justify-content:space-between;align-items:center;margin-bottom:40px}
.brand-name{font-weight:800;font-size:18px;letter-spacing:-.01em}
@media(max-width:800px){.brandbar{flex-direction:column;gap:12px}}
.brand-meta{font-size:12.5px;color:#94a7d6}
.overline{display:inline-flex;align-items:center;gap:8px;font-size:11.5px;font-weight:800;letter-spacing:.32em;color:var(--sky);text-transform:uppercase;margin-bottom:18px}
.overline::before{content:"";width:26px;height:2px;background:var(--sky);border-radius:2px}
@media(max-width:800px){.overline{justify-content:center}}
h1.site{font-size:clamp(34px,5.6vw,58px);font-weight:800;line-height:1.08;letter-spacing:-.02em;color:#fff;margin-bottom:14px;word-break:break-word}
h1.site .grad{background:linear-gradient(92deg,#4cc2ff 10%,#0094ff 60%,#7fd4ff);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.hero-sub{color:#a9bade;max-width:520px;font-size:16px}@media(max-width:800px){.hero-sub{margin:0 auto}}
.hero-tags{display:flex;flex-wrap:wrap;gap:8px;margin-top:22px}@media(max-width:800px){.hero-tags{justify-content:center}}
.tag{font-size:12px;font-weight:700;color:#cfe2ff;background:#ffffff12;border:1px solid #ffffff1f;border-radius:100px;padding:6px 14px}
.scorecard{background:#ffffff0d;border:1px solid #ffffff1a;border-radius:24px;padding:28px 24px;text-align:center;backdrop-filter:blur(10px);justify-self:center}
.donut-wrap{position:relative;width:190px;margin:0 auto}
.donut-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}
.donut-num{font-size:44px;font-weight:800;color:#fff}.donut-sub{font-size:9.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#8fa5d4}
.donut-arc{transition:stroke-dasharray 1.4s cubic-bezier(.22,.8,.35,1)}.score-note{margin-top:14px;font-size:12.5px;color:#94a7d6}
.strip{position:relative;z-index:5;max-width:1020px;margin:-58px auto 0;padding:0 20px 30px;display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
@media(max-width:760px){.strip{grid-template-columns:repeat(2,1fr)}}
.stat{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:18px;box-shadow:var(--shadow);display:flex;flex-direction:column;justify-content:center;gap:2px;min-height:104px}
.stat-num{font-size:30px;font-weight:800;color:var(--ink);font-variant-numeric:tabular-nums}
.stat-num.crit{color:var(--crit)}.stat-num.warn{color:var(--warn)}.stat-num.med{color:var(--med)}.stat-num.info{color:var(--accent)}
.stat-label{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
nav{position:sticky;top:0;z-index:60;background:#ffffffd9;backdrop-filter:blur(14px);border-bottom:1px solid var(--line);display:flex;gap:2px;overflow-x:auto;padding:0 max(16px,calc(50vw - 510px));scrollbar-width:none}
nav::-webkit-scrollbar{display:none}
nav a{color:var(--muted);padding:15px 13px;font-size:13px;font-weight:700;white-space:nowrap;border-bottom:2.5px solid transparent;transition:.18s}
nav a:hover{color:var(--ink);text-decoration:none}nav a.active{color:var(--accent);border-bottom-color:var(--blue)}
main{max-width:1020px;margin:0 auto;padding:10px 20px 40px}
section{background:var(--card);border:1px solid var(--line);border-radius:22px;padding:40px 42px;margin-top:28px;box-shadow:var(--shadow)}
@media(max-width:640px){section{padding:26px 20px;border-radius:16px;margin-top:18px}}
html.js .reveal{opacity:0;transform:translateY(18px);transition:opacity .7s,transform .7s}
html.js .reveal.in{opacity:1;transform:none}
.eyebrow{display:flex;align-items:center;gap:10px;font-size:11.5px;font-weight:800;letter-spacing:.26em;text-transform:uppercase;color:var(--blue);margin-bottom:10px}
.eyebrow .n{color:var(--muted)}.eyebrow::after{content:"";flex:1;height:1px;background:var(--line)}
h2{color:var(--ink);font-size:clamp(22px,3vw,30px);font-weight:800;letter-spacing:-.02em;margin-bottom:16px}
h3{color:var(--ink);font-size:16.5px;font-weight:800;margin:30px 0 12px}
.lead{font-size:16px;margin-bottom:16px;max-width:70ch}.small{font-size:12.5px}.muted{color:var(--muted)}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-top:20px}@media(max-width:640px){.two-col{grid-template-columns:1fr}}
.panel{background:var(--bg);border:1px solid var(--line);border-radius:14px;padding:20px 22px}
.panel h3{margin:0 0 10px;font-size:14px;letter-spacing:.04em;text-transform:uppercase}.panel ol{padding-left:18px}.panel li{margin:7px 0;font-size:14.5px}
.pill{font-size:10px;font-weight:800;letter-spacing:.1em;padding:4px 10px;border-radius:100px;flex-shrink:0}
.pill.crit{background:var(--critbg);color:var(--crit)}.pill.warn{background:var(--warnbg);color:var(--warn)}.pill.med{background:var(--medbg);color:var(--med)}.pill.low{background:var(--line2);color:var(--muted)}
.chip{display:inline-block;font-size:12px;font-weight:800;padding:2px 10px;border-radius:100px}
.chip.crit{background:var(--critbg);color:var(--crit)}.chip.warn{background:var(--warnbg);color:var(--warn)}.chip.good{background:var(--goodbg);color:var(--good)}
.issue{border:1px solid var(--line);border-radius:14px;margin:12px 0;background:#fff;overflow:hidden}
.issue:hover{box-shadow:var(--shadow)}
.issue summary{cursor:pointer;padding:15px 20px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;list-style:none}
.issue summary::-webkit-details-marker{display:none}
.issue-title{font-weight:800;color:var(--ink);font-size:15px;flex:1;min-width:200px}
.issue-page{font-size:12px;color:var(--muted);background:var(--line2);border-radius:6px;padding:2px 8px}
.chev{width:9px;height:9px;border-right:2px solid var(--muted);border-bottom:2px solid var(--muted);transform:rotate(45deg);transition:transform .25s;margin-right:4px}
.issue[open] .chev{transform:rotate(-135deg)}
.issue-body{padding:2px 20px 18px;border-top:1px dashed var(--line)}.issue-body>p{margin-top:12px;font-size:14.5px}
.mini-label{display:inline-block;font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin:12px 0 4px}
.mini-label.fix{color:var(--good)}.affected ul{padding-left:20px;font-size:13.5px}.affected li{margin:3px 0}
.fixline{display:flex;flex-direction:column}.fixline p{font-size:14.5px}.proof{font-size:12.5px;color:var(--muted);margin-top:6px}
.tablewrap{overflow-x:auto;margin:14px 0 6px;border:1px solid var(--line);border-radius:14px}
table{border-collapse:collapse;width:100%;font-size:13.5px;min-width:560px}
th{background:var(--bg);color:var(--muted);text-align:left;padding:11px 16px;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;border-bottom:1px solid var(--line);white-space:nowrap}
th.num{text-align:right}tbody td{padding:10px 16px;border-bottom:1px solid var(--line2)}
tbody tr:last-child td{border-bottom:none}tbody tr:hover{background:#f4f8ff}
td.num{text-align:right;font-variant-numeric:tabular-nums}
td.yes{color:var(--good);font-weight:800;text-align:center;font-size:15px}
td.no{color:var(--warn);background:var(--warnbg);font-weight:800;text-align:center;font-size:15px}
.disclaimer{font-size:13px;background:var(--bg);border:1px solid var(--line);border-left:4px solid var(--blue);border-radius:10px;padding:13px 18px;margin:6px 0 18px}
.bars{margin:14px 0 4px;display:grid;gap:14px}
.bar-top{display:flex;justify-content:space-between;font-size:13.5px;font-weight:700;color:var(--ink);margin-bottom:5px}
.bar-track{background:var(--line2);height:10px;border-radius:100px;overflow:hidden}
.bar-fill{height:100%;border-radius:100px;transition:width 1.2s cubic-bezier(.22,.8,.35,1)}
.bar-fill.crit{background:linear-gradient(90deg,#f97066,var(--crit))}.bar-fill.warn{background:linear-gradient(90deg,#ffb03a,var(--warn))}
.bar-fill.good{background:linear-gradient(90deg,#3ddc97,var(--good))}.bar-fill.neutral{background:linear-gradient(90deg,var(--sky),var(--blue))}
.crit-t{color:var(--crit)}.warn-t{color:var(--warn)}.good-t{color:var(--good)}.neutral-t{color:var(--accent)}
footer{text-align:center;font-size:12.5px;color:var(--muted);padding:30px 16px 40px}
@media(prefers-reduced-motion:reduce){*{transition:none!important}html.js .reveal{opacity:1;transform:none}}
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
