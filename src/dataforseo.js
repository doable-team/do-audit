// DataForSEO REST client (login:password key). All calls optional — the audit
// degrades gracefully when no DataForSEO key is configured.
const BASE = "https://api.dataforseo.com";

const RETRIABLE = (code) => code === 40101 || code === 40202 || code >= 50000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(cfg, path, payload, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(1500 * i);
    try {
      const res = await fetch(BASE + path, {
        method: payload ? "POST" : "GET",
        headers: {
          Authorization: "Basic " + Buffer.from(cfg.keys.dataforseo).toString("base64"),
          "Content-Type": "application/json",
        },
        body: payload ? JSON.stringify(payload) : undefined,
        signal: AbortSignal.timeout(120000),
      });
      if (!res.ok) {
        lastErr = new Error(`DataForSEO HTTP ${res.status} on ${path}`);
        if (res.status >= 500 || res.status === 429) continue;
        throw lastErr;
      }
      const body = await res.json();
      if (body.status_code !== 20000) {
        lastErr = new Error(`DataForSEO ${body.status_code}: ${body.status_message}`);
        if (RETRIABLE(body.status_code)) continue;
        throw lastErr;
      }
      const task = body.tasks?.[0];
      if (!task || task.status_code !== 20000) {
        lastErr = new Error(`DataForSEO task ${task?.status_code}: ${task?.status_message}`);
        if (task && RETRIABLE(task.status_code)) continue;
        throw lastErr;
      }
      return task.result || [];
    } catch (e) {
      lastErr = e;
      if (String(e).includes("DataForSEO")) throw e;
    }
  }
  throw lastErr;
}

export async function rankedKeywords(cfg, domain, loc, lang, limit = 50) {
  const r = await call(cfg, "/v3/dataforseo_labs/google/ranked_keywords/live", [{
    target: domain, location_code: loc, language_code: lang, limit,
    ignore_synonyms: true,
    order_by: ["keyword_data.keyword_info.search_volume,desc"],
    filters: ["ranked_serp_element.serp_item.rank_absolute", "<=", 100],
  }]);
  return (r[0]?.items || []).map((it) => ({
    keyword: it.keyword_data?.keyword,
    volume: it.keyword_data?.keyword_info?.search_volume,
    difficulty: it.keyword_data?.keyword_properties?.keyword_difficulty,
    rank: it.ranked_serp_element?.serp_item?.rank_absolute,
    url: it.ranked_serp_element?.serp_item?.url,
  }));
}

export async function competitors(cfg, domain, loc, lang, limit = 8) {
  const r = await call(cfg, "/v3/dataforseo_labs/google/competitors_domain/live", [{
    target: domain, location_code: loc, language_code: lang, limit,
    exclude_top_domains: true,
  }]);
  return (r[0]?.items || []).map((it) => {
    const org = it.full_domain_metrics?.organic || it.metrics?.organic || {};
    return {
      domain: it.domain,
      intersections: it.intersections,
      organic_keywords: org.count,
      est_traffic: Math.round(org.etv || 0),
    };
  });
}

export async function serp(cfg, keyword, loc, lang, depth = 20) {
  const r = await call(cfg, "/v3/serp/google/organic/live/advanced", [{
    keyword, location_code: loc, language_code: lang, depth,
  }]);
  const items = r[0]?.items || [];
  const types = r[0]?.item_types || [];
  const organic = [];
  const aiDomains = new Set();
  for (const it of items) {
    if (it.type === "organic") {
      organic.push({ pos: it.rank_absolute, domain: it.domain, url: it.url });
    } else if (it.type === "ai_overview") {
      for (const ref of it.references || []) if (ref.domain) aiDomains.add(ref.domain);
      for (const sub of it.items || [])
        for (const ref of sub.references || []) if (ref.domain) aiDomains.add(ref.domain);
    }
  }
  return { keyword, hasAIOverview: types.includes("ai_overview"),
           aiDomains: [...aiDomains], organic };
}

export async function backlinksSummary(cfg, domain) {
  const r = await call(cfg, "/v3/backlinks/summary/live", [{
    target: domain, include_subdomains: true, exclude_internal_backlinks: true,
    internal_list_limit: 10,
  }]);
  const d = r[0] || {};
  return { domain, rank: d.rank, backlinks: d.backlinks,
           referring_domains: d.referring_domains };
}

export async function rankOverview(cfg, domain, loc, lang) {
  const r = await call(cfg, "/v3/dataforseo_labs/google/domain_rank_overview/live", [{
    target: domain, location_code: loc, language_code: lang,
  }]);
  const m = r[0]?.items?.[0]?.metrics || {};
  return { domain, organic_keywords: m.organic?.count,
           est_traffic: Math.round(m.organic?.etv || 0) };
}

// AI-visibility testing via DataForSEO's AI Optimization API — the same
// engine the original audit agent uses. DataForSEO runs the prompt on the
// real LLM platform and returns the answer text plus cited URLs.
export const AI_PROVIDERS = [
  { provider: "chat_gpt", model: "gpt-4o-mini", web: true, label: "ChatGPT" },
  { provider: "perplexity", model: "sonar", web: false, label: "Perplexity" },
  { provider: "gemini", model: "gemini-2.5-flash", web: false, label: "Gemini" },
];

export async function llmResponse(cfg, prompt, provider, model, webSearch) {
  const task = { user_prompt: prompt, model_name: model, max_output_tokens: 700 };
  if (webSearch) task.web_search = true;
  const r = await call(cfg, `/v3/ai_optimization/${provider}/llm_responses/live`, [task]);
  const d = r[0] || {};
  const parts = [];
  const urls = [];
  for (const it of d.items || []) {
    for (const sec of it.sections || []) {
      if (sec.text) parts.push(sec.text);
      for (const ann of sec.annotations || []) if (ann.url) urls.push(ann.url);
    }
  }
  return { provider, response: parts.join("\n").slice(0, 4000), cited: urls.slice(0, 20) };
}

// Common markets → DataForSEO location codes (fallback when the LLM can't
// infer one, or the user passes --market).
export const MARKETS = {
  US: 2840, GB: 2826, IN: 2356, AU: 2036, CA: 2124, DE: 2276, FR: 2250,
  ES: 2724, IT: 2380, NL: 2528, AE: 2784, SA: 2682, SG: 2702, JP: 2392,
  BR: 2076, MX: 2484, ZA: 2710, NG: 2566, KE: 2404, PH: 2608, ID: 2360,
  MY: 2458, TH: 2764, VN: 2704, PK: 2586, BD: 2050, LK: 2144, NZ: 2554,
  IE: 2372, SE: 2752, NO: 2578, DK: 2208, FI: 2246, PL: 2616, PT: 2620,
  CH: 2756, AT: 2040, BE: 2056, TR: 2792, IL: 2376, EG: 2818, QA: 2634,
  KW: 2414, BH: 2048, OM: 2512, UK: 2826, KR: 2410, CN: 2156, AR: 2032, NP: 2524,
};
