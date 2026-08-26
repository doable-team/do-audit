// LLM stages: the research brief (business summary, market, competitors,
// keyword shortlist, AI-visibility test prompts) and the final audit analysis.
import { chatJSON } from "./ai.js";

export async function brief(cfg, domain, home, tech, ranked, hasDataForSEO) {
  return chatJSON(cfg,
    "You are an expert SEO strategist. Strict JSON only. Base everything on the provided data; " +
    "anything uncertain goes into assumptions as a quoted sentence.",
    JSON.stringify({
      task:
        "From the homepage snapshot: (1) write a 2-3 sentence business_summary and extract brand_name; " +
        "(2) determine the primary target market as ISO-3166 alpha-2 (market_iso) with a one-line market_reason; " +
        "(3) list 3 direct competitor domains (real companies competing for the same customers" +
        (hasDataForSEO ? ", refine the candidates given" : "") + "); " +
        "(4) build shortlist: the 10 most commercially relevant keywords " +
        (hasDataForSEO
          ? "chosen from ranked_keywords (keep their volume/difficulty/rank numbers)"
          : "as {keyword} objects (no volume data available — leave volume/difficulty/rank null)") + "; " +
        "(5) write 5 AI-visibility test prompts via query fan-out, one each: recommendation, comparison, " +
        "best-of list, problem-solving, local-or-niche discovery — phrased as a real user would ask an AI assistant, " +
        "NEVER naming the brand itself. " +
        "Return {brand_name, business_summary, market_iso, market_reason, competitors:[domains], " +
        "shortlist:[{keyword,volume,difficulty,rank}], prompts:[{prompt,category}], assumptions:[]}",
      domain, homepage: home, tech_summary: {
        robots: tech?.robots, sitemap: tech?.sitemap, llmsTxt: tech?.llmsTxt,
      },
      ranked_keywords: (ranked || []).slice(0, 40),
    }), 3000);
}

export async function analyze(cfg, data) {
  return chatJSON(cfg,
    "You are an elite SEO auditor writing a professional, client-ready audit report. " +
    "Strict JSON. Use ONLY the provided data — never invent numbers. Frame findings constructively as opportunity. " +
    "Every issue needs an evidence string (url + what was observed). Anything uncertain goes in assumptions as a quoted sentence.",
    JSON.stringify({
      task:
        "Produce {score (0-100), executive_summary, top_issues:[PLAIN STRINGS — the highest-priority issues], " +
        "quick_wins:[PLAIN STRINGS], technical_summary, " +
        "technical_issues:[{issue,severity: the WORD critical|high|medium|low (never a number),details,recommendation,evidence,affected_urls?}] " +
        "— EXHAUSTIVE: include EVERY technical issue the data supports, no matter how many; do NOT cap or summarize the list, " +
        "onpage_summary, onpage_issues:[same shape plus page] — EXHAUSTIVE: include EVERY on-page issue the data supports " +
        "across all crawled pages, do NOT cap the list, " +
        "keyword_summary, competitor_summary, comparison_summary, ai_summary, crawler_access, " +
        "recommendations:[{priority: the WORD critical|high|medium|low (never a number),action,impact}], " +
        "assumptions:[], sov:[{brand,mentions}] (count how often the site vs each competitor is mentioned across ai_responses)}",
      ...data,
    }), 16000);
}
