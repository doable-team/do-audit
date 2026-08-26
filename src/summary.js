// The machine-readable view of an audit result — what `--agent` prints on
// stdout. Deliberately a curated projection of the full data object, not a
// dump: an AI agent has to fit this in its context window, so raw HTML,
// internal-link lists and full SERP tables are summarized or dropped.
// `--full` adds the untouched data object under `raw`.

const sevOf = (x) => String(x?.severity || "").toLowerCase();

export function issueCounts(analysis) {
  const all = [...(analysis?.technical_issues || []), ...(analysis?.onpage_issues || [])];
  const counts = { critical: 0, high: 0, medium: 0, low: 0, total: all.length };
  for (const i of all) if (counts[sevOf(i)] !== undefined) counts[sevOf(i)]++;
  return counts;
}

const issue = (x) => ({
  issue: x.issue,
  severity: sevOf(x) || "medium",
  page: x.page || undefined,
  details: x.details || "",
  recommendation: x.recommendation || "",
  evidence: x.evidence || "",
  affected_urls: (x.affected_urls || []).slice(0, 10),
});

export function buildSummary(d, warnings = [], { version, files = null, full = false } = {}) {
  const a = d.analysis || {};
  const t = d.tech || {};
  const out = {
    ok: true,
    tool: "do-audit",
    version,
    domain: d.domain,
    date: d.date,
    score: a.score ?? null,
    executive_summary: a.executive_summary || "",

    business: {
      brand: d.brief?.brand_name || "",
      summary: d.brief?.business_summary || "",
      market: d.market?.iso || "",
      market_reason: d.market?.reason || "",
    },

    issues: {
      counts: issueCounts(a),
      top: a.top_issues || [],
      quick_wins: a.quick_wins || [],
      technical: (a.technical_issues || []).map(issue),
      onpage: (a.onpage_issues || []).map(issue),
    },

    recommendations: (a.recommendations || []).map((r) => ({
      priority: String(r.priority || "").toLowerCase() || "medium",
      action: r.action || "",
      impact: r.impact || "",
    })),

    performance: d.psi?.error ? { error: d.psi.error } : {
      score: d.psi?.score ?? null,
      lcp: d.psi?.lcp || null, cls: d.psi?.cls || null, tbt: d.psi?.tbt || null,
      field_data: d.psi?.fieldOverall || null,
      report: d.psi?.link || null,
    },

    technical: {
      https_redirects: t.variants || {},
      robots: t.robots || {},
      sitemap: t.sitemap || {},
      soft_404: t.notFound?.soft404 ?? null,
      llms_txt: t.llmsTxt ?? null,
      blocked_ai_bots: t.robots?.blockedAIBots || [],
      security_headers: d.home?.headers || {},
    },

    crawl: {
      pages_crawled: 1 + (d.pages?.length || 0),
      pages: [d.home, ...(d.pages || [])].filter(Boolean).map((p) => ({
        url: p.finalUrl || p.url,
        status: p.status,
        title: p.title || "",
        title_length: (p.title || "").length,
        meta_description: p.metaDescription || "",
        meta_description_length: (p.metaDescription || "").length,
        canonical: p.canonical || "",
        h1: p.h1 || [],
        word_count: p.wordCount ?? null,
        images: p.images || null,
        schema_types: p.schemaTypes || [],
        response_ms: p.responseMs ?? null,
      })),
    },

    keywords: (d.brief?.shortlist || []).map((k) => ({
      keyword: k.keyword,
      volume: k.volume ?? null,
      difficulty: k.difficulty ?? null,
      rank: k.rank ?? null,
    })),
    ranked_keywords: (d.ranked || []).slice(0, 50),

    serps: (d.serpResults || []).map((r) => {
      const mine = (r.organic || []).find((o) =>
        String(o.domain || "").replace(/^www\./, "") === d.domain);
      return {
        keyword: r.keyword,
        has_ai_overview: r.hasAIOverview,
        site_position: mine?.pos ?? null,              // rank among organic results
        site_position_absolute: mine?.absPos ?? null,  // rank counting SERP features
        site_cited_in_ai_overview: (r.aiDomains || [])
          .some((x) => String(x).replace(/^www\./, "") === d.domain),
        top_3: (r.organic || []).slice(0, 3).map((o) => ({ pos: o.pos, domain: o.domain })),
        organic_results: (r.organic || []).length,
      };
    }),

    competitors: {
      picked: d.brief?.competitors || [],
      source: d.candidateSource || "AI-suggested (no ranking data)",
      candidates: d.compCandidates || [],
      profiles: (d.compData || []).map((c) => ({ ...c, dr: d.dr?.[c.domain] ?? null })),
    },

    authority: {
      backlinks: d.siteBacklinks?.backlinks ?? null,
      referring_domains: d.siteBacklinks?.referring_domains ?? null,
      organic_keywords: d.siteRank?.organic_keywords ?? null,
      est_traffic: d.siteRank?.est_traffic ?? null,
      domain_rating: d.dr?.[d.domain] ?? null,
    },

    ai_visibility: {
      visibility_pct: d.aiMetrics?.visibility ?? null,
      citation_rate_pct: d.aiMetrics?.citationRate ?? null,
      responses_tested: d.aiMetrics?.total ?? 0,
      per_platform: d.aiMetrics?.perPlatform || {},
      matrix: d.aiMetrics?.matrix || [],
      share_of_voice: a.sov || [],
      prompts: (d.brief?.prompts || []).map((p) => ({ prompt: p.prompt, category: p.category || "" })),
    },

    summaries: {
      technical: a.technical_summary || "",
      onpage: a.onpage_summary || "",
      keyword: a.keyword_summary || "",
      competitor: a.competitor_summary || "",
      comparison: a.comparison_summary || "",
      ai: a.ai_summary || "",
      crawler_access: a.crawler_access || "",
    },

    assumptions: [...new Set([...(d.brief?.assumptions || []), ...(a.assumptions || [])])],
    // Steps that degraded (missing key, API error) — data absent, not zero.
    warnings,
    data_sources: {
      dataforseo: !!d.hasDataForSEO,
      pagespeed: !d.psi?.error,
      ahrefs: !!d.dr,
    },
  };
  if (files) out.files = { report: files.outFile, notes: files.notesFile, json: files.jsonFile || undefined };
  if (full) out.raw = d;
  return out;
}
