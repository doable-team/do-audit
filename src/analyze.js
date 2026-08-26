// LLM stages, mirroring the two-stage research the audit pipeline needs:
//   understand — business, brand and target market from the crawled pages only
//   strategy   — competitors, keyword shortlist and AI test prompts, chosen
//                AFTER the SEO data is in (so the LLM curates real data)
//   analyze    — the final audit analysis
import { chatJSON } from "./ai.js";

export async function understand(cfg, home, pages) {
  return chatJSON(cfg,
    "You are an expert SEO strategist. Reply with strict JSON only. " +
    "Never invent data; base everything only on the evidence provided.",
    JSON.stringify({
      task: "From the crawled pages: (1) describe the business precisely (what it sells, audience, " +
        "geography) using only what the pages state; (2) identify the brand name; (3) determine the PRIMARY " +
        "target market country as ISO-3166 alpha-2 (evidence: addresses, phone country codes, currency, " +
        "language, audience/locations named on the pages; if genuinely global use 'US') plus a one-sentence " +
        "market_reason citing that evidence; (4) list any assumptions you had to make, each as a quoted sentence. " +
        "Return {business_summary, brand_name, market_country_iso, market_reason, assumptions:[]}",
      homepage: { title: home?.title, description: home?.metaDescription,
        h1: home?.h1, h2: home?.h2, words: home?.wordCount },
      pages: (pages || []).map((p) => ({ url: p.url, title: p.title, h1: p.h1 })),
    }), 2000);
}

export async function strategy(cfg, { business, brand, market, ranked, candidates, force }) {
  // Branch on whether each data set actually has rows — a configured
  // DataForSEO key with zero results (new/small sites) must behave like
  // having no data, or the never-invent-data rule makes the LLM return
  // an empty strategy.
  const hasKw = (ranked || []).length > 0;
  const hasComp = (candidates || []).length > 0;
  return chatJSON(cfg,
    "You are an expert SEO strategist. Reply with strict JSON only. " +
    "Never invent metrics; base metric values only on the evidence provided. " +
    "Keyword ideas, competitor names and test prompts however MUST always be produced from the " +
    "business context — an empty shortlist or empty prompts list is never an acceptable answer.",
    JSON.stringify({
      task: "Given the verified business" + (hasKw || hasComp ? " and its data for the target market" : "") +
        ": (1) pick up to 3 TRUE business competitors " +
        (hasComp
          ? "from candidates (exclude marketplaces/media/giants)"
          : "from your knowledge of this business's space (real companies competing for the same customers; " +
            "exclude marketplaces/media/giants)") + "; " +
        "(2) build a shortlist of EXACTLY 10 MID-TAIL or LONG-TAIL keywords (2+ words, clear intent, no broad " +
        "head terms) " +
        (hasKw
          ? "mixing currently-ranking, striking-distance (rank 4-30) and opportunity terms relevant to the " +
            "target market — carry over each keyword's volume/difficulty/rank from ranked_keywords when present"
          : "this business should target in its market (no keyword metrics available — set volume, difficulty " +
            "and rank to null, but the 10 keywords themselves are REQUIRED)") + "; " +
        "(3) write 5 AI-visibility test prompts via query fan-out, one each: recommendation, comparison, " +
        "informational, local-or-audience, transactional — phrased as a real user would ask an AI assistant, " +
        "NEVER naming the brand itself; (4) list any assumptions, each as a quoted sentence. " +
        (force ? "IMPORTANT: a previous attempt returned an empty shortlist/prompts — that is invalid. " +
          "You MUST return exactly 10 keywords and 5 prompts derived from the business description. " : "") +
        "Return {competitors:[domains], shortlist:[{keyword,volume,difficulty,rank}], prompts:[{prompt,category}], assumptions:[]}",
      business, brand,
      target_market: market,
      ranked_keywords: (ranked || []).slice(0, 40),
      competitor_candidates: candidates || [],
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
