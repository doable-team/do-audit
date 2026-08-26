// Renders the full audit result in the terminal — the primary output.
// The HTML report is generated on demand from the interactive menu.
import { c, bold, dim, green, red, yellow, cyan, gray } from "./ui.js";

const W = () => Math.max(60, Math.min(process.stdout.columns || 100, 100));

function wrap(text, indent = 4, width = W()) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).length > width - indent) { lines.push(line); line = w; }
    else line = line ? line + " " + w : w;
  }
  if (line) lines.push(line);
  return lines.map((l) => " ".repeat(indent) + l).join("\n");
}

const head = (title) =>
  "\n  " + c.bold + title.toUpperCase() + c.reset + "  " +
  gray("─".repeat(Math.max(2, W() - title.length - 6))) + "\n";

const SEV = {
  critical: (s) => c.red + c.bold + s + c.reset,
  high: (s) => c.yellow + s + c.reset,
  medium: (s) => c.magenta + s + c.reset,
  low: (s) => c.gray + s + c.reset,
};
const sevTag = (sev) => (SEV[sev] || SEV.low)(`[${(sev || "low").toUpperCase()}]`);

const meter = (pct, width = 22) => {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const filled = Math.round((p / 100) * width);
  const color = p < 25 ? c.red : p < 50 ? c.yellow : c.green;
  return color + "█".repeat(filled) + c.reset + gray("░".repeat(width - filled)) +
    " " + String(p).padStart(3) + "%";
};

const fmt = (n) => (n == null || n === "" ? "—"
  : typeof n === "number" && Math.abs(n) >= 1000 ? n.toLocaleString("en-US") : String(n));

// Minimal ANSI-aware table.
const strip = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, "");
function tbl(headers, rows, indent = 4) {
  const all = [headers, ...rows];
  const widths = headers.map((_, i) =>
    Math.min(42, Math.max(...all.map((r) => strip(r[i] ?? "").length))));
  const pad = (cell, w) => {
    const s = String(cell ?? "");
    const len = strip(s).length;
    return len > w ? strip(s).slice(0, w - 1) + "…" : s + " ".repeat(w - len);
  };
  const line = (r, deco = (x) => x) =>
    " ".repeat(indent) + r.map((cl, i) => deco(pad(cl, widths[i]))).join("  ");
  return [line(headers, (s) => gray(s.toUpperCase())),
    " ".repeat(indent) + gray(widths.map((w) => "─".repeat(w)).join("──")),
    ...rows.map((r) => line(r))].join("\n");
}

function issueBlock(x, showPage) {
  const out = [`  ${sevTag(x.severity)} ${bold(x.issue || "")}` +
    (showPage && x.page ? gray("  " + x.page) : "")];
  if (x.details) out.push(dim(wrap(x.details)));
  if (x.recommendation) out.push(green("    → ") + wrap(x.recommendation, 6).trimStart());
  if (x.evidence) out.push(gray(wrap("evidence: " + x.evidence, 6)));
  return out.join("\n");
}

export function printTerminalReport(d, warnings = []) {
  const a = d.analysis || {}, brief = d.brief || {}, ai = d.aiMetrics || {};
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const x of [...(a.technical_issues || []), ...(a.onpage_issues || [])]) {
    const s = String(x.severity || "").toLowerCase();
    if (s in counts) counts[s]++;
  }
  const score = a.score ?? 0;
  const scoreCol = score < 50 ? red : score < 75 ? yellow : green;
  const platforms = Object.keys(ai.perPlatform || {});

  console.log(head(`SEO Audit — ${d.domain}`));
  console.log(`    ${bold("Health Score")}  ${scoreCol(bold(score + "/100"))}   ` +
    `${red(counts.critical + " critical")} · ${yellow(counts.high + " high")} · ` +
    `${counts.medium} medium · ${gray(counts.low + " low")}   ` +
    gray(`market ${d.market?.iso || "?"} · ${d.date}`));

  if (a.executive_summary) {
    console.log(head("Executive Summary"));
    console.log(wrap(a.executive_summary));
  }
  if ((a.top_issues || []).length) {
    console.log("\n    " + bold("Top priority issues"));
    a.top_issues.forEach((t, i) => console.log(wrap(`${i + 1}. ${t}`, 6)));
  }
  if ((a.quick_wins || []).length) {
    console.log("\n    " + bold("Quick wins"));
    a.quick_wins.forEach((t, i) => console.log(green("      ✓ ") + wrap(t, 8).trimStart()));
  }

  console.log(head(`Technical Issues (${(a.technical_issues || []).length})`));
  if (a.technical_summary) console.log(wrap(a.technical_summary) + "\n");
  (a.technical_issues || []).forEach((x) => console.log(issueBlock(x) + "\n"));
  if (d.psi && !d.psi.error) {
    console.log(`    ${bold("Core Web Vitals")} ${gray("(mobile)")}  ` +
      `score ${d.psi.score ?? "—"}/100 · LCP ${d.psi.lcp || "—"} · CLS ${d.psi.cls || "—"} · TBT ${d.psi.tbt || "—"}`);
  }

  console.log(head(`On-Page Issues (${(a.onpage_issues || []).length})`));
  if (a.onpage_summary) console.log(wrap(a.onpage_summary) + "\n");
  (a.onpage_issues || []).forEach((x) => console.log(issueBlock(x, true) + "\n"));

  const shortlist = brief.shortlist || [];
  if (shortlist.length) {
    console.log(head("Keywords & Rankings"));
    if (a.keyword_summary) console.log(wrap(a.keyword_summary) + "\n");
    const rankOf = (k) => {
      const r = (d.serpResults || []).find((s) => s.keyword === k.keyword);
      const hit = r?.organic?.find((o) =>
        (o.domain || "").replace(/^www\./, "") === d.domain.replace(/^www\./, ""));
      return hit?.pos ?? k.rank;
    };
    const rankedCount = shortlist.filter((k) => { const r = rankOf(k); return r != null && r !== 0; }).length;
    console.log(`    ${bold("Ranking for " + rankedCount + " of " + shortlist.length + " main keywords")}` +
      (rankedCount < shortlist.length ? gray(` — ${shortlist.length - rankedCount} still up for grabs`) : "") + "\n");
    console.log(tbl(["Keyword", "Volume", "KD", "Rank"],
      shortlist.map((k) => {
        const r = rankOf(k);
        return [k.keyword, fmt(k.volume), fmt(k.difficulty),
          r ? (r <= 10 ? green("#" + r) : yellow("#" + r)) : red("—")];
      })));
  }

  const comps = brief.competitors || [];
  if (comps.length) {
    console.log(head("Competitors"));
    if (a.competitor_summary) console.log(wrap(a.competitor_summary) + "\n");
    if ((d.compData || []).length) {
      console.log(tbl(["Domain", "Backlinks", "Ref. Domains", "Traffic/mo", "DR"], [
        [cyan(d.domain + " (you)"), fmt(d.siteBacklinks?.backlinks), fmt(d.siteBacklinks?.referring_domains),
          fmt(d.siteRank?.est_traffic), fmt(d.dr?.[d.domain])],
        ...d.compData.map((cd) => [cd.domain, fmt(cd.backlinks), fmt(cd.referring_domains),
          fmt(cd.est_traffic), fmt(d.dr?.[cd.domain])]),
      ]));
    } else {
      console.log(tbl(["Domain", "Keywords Ranked For"],
        (d.compCandidates || []).filter((cd) => comps.includes(cd.domain))
          .map((cd) => [cd.domain, fmt(cd.intersections)])));
      if (d.candidateSource) console.log(gray(`\n    discovered via live web search (${d.candidateSource})`));
    }
  }

  console.log(head("AI Visibility"));
  if (a.ai_summary) console.log(wrap(a.ai_summary) + "\n");
  console.log(`    ${"AI Visibility".padEnd(16)} ${meter(ai.visibility)}`);
  console.log(`    ${"Citation Rate".padEnd(16)} ${meter(ai.citationRate)}`);
  for (const [p, v] of Object.entries(ai.perPlatform || {})) {
    console.log(`    ${("· " + p).padEnd(16)} ${meter(v)}`);
  }
  if ((ai.matrix || []).length && platforms.length) {
    console.log("\n" + tbl(["Prompt", ...platforms],
      ai.matrix.map((row) => [row.prompt,
        ...platforms.map((p) => (row.results?.[p] ? green("✓") : red("✗")))])));
  }
  const ao = (d.serpResults || []).filter((s) => s.hasAIOverview);
  if (ao.length) {
    console.log("\n    " + bold("Google AI Overviews") + gray(` — shown on ${ao.length} of ${d.serpResults.length} keywords`));
    ao.forEach((s) => console.log(`      ${s.aiDomains?.some((x) => x.includes(d.domain)) ? green("✓ cited") : red("✗ not cited")}  ${s.keyword}`));
  }
  if (a.crawler_access) console.log("\n    " + bold("AI crawler access: ") + wrap(a.crawler_access, 6).trimStart());

  if ((a.recommendations || []).length) {
    console.log(head("Action Plan"));
    a.recommendations.forEach((r) => {
      console.log(`  ${sevTag(r.priority)} ${bold(r.action || "")}`);
      if (r.impact) console.log(dim(wrap(r.impact)));
    });
  }

  if ((a.assumptions || []).length) {
    console.log("\n    " + gray(`${a.assumptions.length} assumption${a.assumptions.length > 1 ? "s" : ""} to verify — included in the internal notes when you save the HTML report.`));
  }
  if (warnings.length) {
    console.log("\n    " + yellow("Warnings") + gray(" (data that could not be collected)"));
    for (const w of warnings) console.log(gray("      · " + w));
  }
  console.log();
}
