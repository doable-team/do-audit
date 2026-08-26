// Internal notes page, ported from the audit agent: assumptions to verify,
// AI-determined target market, pipeline warnings, methodology reminders.
// Written alongside every report as <report>-notes.html — for the auditor's
// eyes, not the client's.
import { esc } from "./report.js";

export function renderNotes(cfg, d, warnings) {
  const a = d.analysis || {};
  const assumptions = [...(a.assumptions || [])];
  const items = assumptions.map((x, i) =>
    `<li><label><input type="checkbox"> ${i + 1}. &ldquo;${esc(x)}&rdquo;</label></li>`).join("");
  const errs = (warnings || []).map((e) => `<li class="err">${esc(e)}</li>`).join("");
  const platforms = Object.keys(d.aiMetrics?.perPlatform || {});
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Internal Notes — ${esc(d.domain)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>
body{font-family:'Inter',system-ui,sans-serif;background:#F5F4EF;color:#5A5855;max-width:760px;margin:0 auto;padding:40px 20px;line-height:1.7}
h1{color:#1A1918;font-size:26px;font-weight:700}h2{color:#15803D;font-size:15px;margin-top:28px;text-transform:uppercase;letter-spacing:.06em}
.warn{background:#FDF1E4;border-left:4px solid #EA7317;border-radius:8px;padding:12px 16px;font-size:13.5px;margin:16px 0}
ul{padding-left:4px;list-style:none}li{margin:10px 0;background:#fff;border:1px solid #E2DFD8;border-radius:10px;padding:12px 16px}
li.err{background:#FDECEB;border-color:#F3C1C1;font-size:13px}
a{color:#15803D}.meta{color:#8E8B82;font-size:13px}
</style></head><body>
<h1>Internal Notes — ${esc(d.domain)}</h1>
<p class="meta">${esc(d.date || "")} · INTERNAL — review before sharing the report with anyone.</p>
<div class="warn">Cross-check every assumption below before sending the report.
All numbers come from the live crawl${d.hasDataForSEO ? " + DataForSEO" : ""}${d.dr ? " + Ahrefs" : ""}${d.psi && !d.psi.error ? " + PageSpeed" : ""} data collected on the date above.</div>
<h2>Target market (AI-determined)</h2>
<ul><li><b>${esc(d.market?.iso || "US")}</b> (DataForSEO location ${esc(d.market?.location_code || 2840)}) — ${esc(d.market?.reason || "no reasoning recorded")}</li></ul>
<h2>Assumptions to verify</h2>
<ul>${items || "<li>No assumptions recorded.</li>"}</ul>
${errs ? `<h2>Pipeline warnings (data that could not be collected)</h2><ul>${errs}</ul>` : ""}
<h2>Methodology reminders (shown in the report)</h2>
<ul><li>AI visibility scores are based on ${(d.brief?.prompts || []).length || 5} query fan-out prompts, single run per platform (${esc(platforms.join(", "))}).</li>
${d.hasDataForSEO ? "<li>Keyword/backlink/traffic data: DataForSEO · CWV: PageSpeed Insights" + (d.dr ? " · DR: Ahrefs APIv3" : "") + ".</li>"
  : "<li>No DataForSEO key was configured — keywords are AI-suggested and carry no volume/rank data.</li>"}
<li>Screenshots are not captured — verify visual claims manually if needed.</li>
<li>Edit the report in place with: <b>do-audit edit ${esc(d.reportFile || "&lt;report&gt;.html")}</b></li></ul>
</body></html>`;
}
