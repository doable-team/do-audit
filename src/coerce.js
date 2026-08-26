// LLM JSON is loosely typed in the wild: arrays arrive as comma-joined
// strings, list items as bare strings, a single URL where a list belongs.
// Normalize once so the pipeline and renderer can trust every shape.

export const asList = (v) => Array.isArray(v) ? v
  : v == null || v === "" ? []
  : typeof v === "string" ? v.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean)
  : [v];

const asObj = (v, key) =>
  v && typeof v === "object" && !Array.isArray(v) ? v : { [key]: String(v ?? "") };

const normIssue = (x) => {
  const o = asObj(x, "issue");
  return { ...o,
    issue: String(o.issue ?? o.title ?? ""),
    evidence: Array.isArray(o.evidence) ? o.evidence.map(String).join(" · ")
      : o.evidence == null ? "" : String(o.evidence),
    affected_urls: asList(o.affected_urls).map(String),
  };
};

export function normalizeBrief(b) {
  const out = { ...(b || {}) };
  out.competitors = asList(out.competitors).map(String)
    .map((s) => s.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""))
    .filter(Boolean);
  out.shortlist = asList(out.shortlist).map((k) => asObj(k, "keyword")).filter((k) => k.keyword);
  out.prompts = asList(out.prompts).map((p) => asObj(p, "prompt")).filter((p) => p.prompt);
  out.assumptions = asList(out.assumptions).map(String);
  return out;
}

export function normalizeAnalysis(a) {
  const out = { ...(a || {}) };
  out.top_issues = asList(out.top_issues);
  out.quick_wins = asList(out.quick_wins);
  out.technical_issues = asList(out.technical_issues).map(normIssue);
  out.onpage_issues = asList(out.onpage_issues).map(normIssue);
  out.recommendations = asList(out.recommendations).map((r) => asObj(r, "action"));
  out.assumptions = asList(out.assumptions).map(String);
  out.sov = asList(out.sov)
    .map((s) => (s && typeof s === "object" && !Array.isArray(s) ? s : { brand: String(s) }))
    .map((s) => ({ brand: String(s.brand ?? ""), mentions: Number(s.mentions) || 0 }))
    .filter((s) => s.brand);
  out.score = Math.max(0, Math.min(100, Number(out.score) || 0));
  return out;
}
