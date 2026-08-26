// Site crawling + technical checks + PageSpeed Insights.
const UA = "Mozilla/5.0 (compatible; do-audit/1.0; +https://github.com/doable-team/do-audit)";

async function get(url, timeoutMs = 20000) {
  return fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,*/*" },
    redirect: "follow", signal: AbortSignal.timeout(timeoutMs),
  });
}

function pick(re, html) {
  const m = html.match(re);
  return m ? m[1].trim() : "";
}

export async function fetchPage(url) {
  const t0 = Date.now();
  let res;
  try { res = await get(url); }
  catch (e) { return { url, error: String(e.message || e) }; }
  const ms = Date.now() - t0;
  const html = (await res.text()).slice(0, 900000);
  const metas = {};
  for (const m of html.matchAll(/<meta[^>]+(?:name|property)=["']([^"']+)["'][^>]*content=["']([^"']*)["']/gi)) {
    metas[m[1].toLowerCase()] = m[2].slice(0, 400);
  }
  for (const m of html.matchAll(/<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']([^"']+)["']/gi)) {
    if (!(m[2].toLowerCase() in metas)) metas[m[2].toLowerCase()] = m[1].slice(0, 400);
  }
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)]
    .map((m) => m[1].replace(/<[^>]+>/g, "").trim()).filter(Boolean).slice(0, 5);
  const h2s = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)]
    .map((m) => m[1].replace(/<[^>]+>/g, "").trim()).filter(Boolean).slice(0, 12);
  const imgs = [...html.matchAll(/<img[^>]*>/gi)].map((m) => m[0]);
  const missingAlt = imgs.filter((t) => !/alt=["'][^"']+["']/i.test(t));
  const canonical = pick(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i, html)
    || pick(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i, html);
  const ldTypes = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)]
    .flatMap((m) => { try {
      const d = JSON.parse(m[1]);
      const arr = Array.isArray(d) ? d : (d["@graph"] || [d]);
      return arr.map((n) => n && n["@type"]).filter(Boolean).flat();
    } catch { return ["INVALID_JSON_LD"]; } });
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi, " ");
  const words = (text.match(/\w+/g) || []).length;
  const links = [...html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)].map((m) => m[1]);
  return {
    url, finalUrl: res.url, status: res.status, responseMs: ms,
    title: pick(/<title[^>]*>([\s\S]*?)<\/title>/i, html).slice(0, 300),
    metaDescription: metas["description"] || "",
    metaRobots: metas["robots"] || "",
    canonical, viewport: metas["viewport"] || "",
    ogTitle: metas["og:title"] || "", ogImage: metas["og:image"] || "",
    twitterCard: metas["twitter:card"] || "",
    h1: h1s, h2: h2s, wordCount: words,
    images: { total: imgs.length, missingAlt: missingAlt.length },
    schemaTypes: [...new Set(ldTypes)].slice(0, 12),
    internalLinks: links.filter((l) => !l.startsWith("http") || l.includes(new URL(res.url).hostname)).slice(0, 200),
    headers: {
      hsts: res.headers.has("strict-transport-security"),
      xcto: res.headers.get("x-content-type-options") || "",
      xfo: res.headers.get("x-frame-options") || "",
      csp: res.headers.has("content-security-policy"),
      encoding: res.headers.get("content-encoding") || "none",
    },
  };
}

export async function techCheck(domain) {
  const out = { domain };
  const variants = {};
  for (const v of [`http://${domain}/`, `https://${domain}/`, `https://www.${domain}/`]) {
    try {
      const r = await fetch(v, { headers: { "User-Agent": UA }, redirect: "manual",
        signal: AbortSignal.timeout(15000) });
      variants[v] = { status: r.status, location: r.headers.get("location") || "" };
    } catch (e) { variants[v] = { error: String(e.message || e).slice(0, 120) }; }
  }
  out.variants = variants;
  try {
    const r = await get(`https://${domain}/robots.txt`);
    const txt = r.status === 200 ? await r.text() : "";
    out.robots = {
      exists: r.status === 200,
      sitemaps: [...txt.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1]),
      disallowAll: /user-agent:\s*\*\s*[\r\n]+disallow:\s*\/\s*$/im.test(txt),
      blockedAIBots: ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended", "CCBot"]
        .filter((b) => new RegExp(`user-agent:\\s*${b}`, "i").test(txt)),
    };
  } catch { out.robots = { exists: false, error: true }; }
  try {
    const sm = out.robots?.sitemaps?.[0] || `https://${domain}/sitemap.xml`;
    const r = await get(sm);
    const body = r.status === 200 ? await r.text() : "";
    out.sitemap = { url: sm, status: r.status,
      urlCount: (body.match(/<loc>/g) || []).length,
      isIndex: body.includes("<sitemapindex") };
    out.sitemapUrls = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).slice(0, 40);
  } catch { out.sitemap = { status: null }; }
  try {
    const r = await get(`https://${domain}/audit-404-check-${Date.now()}`);
    out.notFound = { status: r.status, soft404: r.status === 200 };
  } catch { out.notFound = {}; }
  try {
    const r = await get(`https://${domain}/llms.txt`);
    out.llmsTxt = r.status === 200;
  } catch { out.llmsTxt = false; }
  return out;
}

// PageSpeed Insights — works without a key (shared quota); a Google API key
// removes the rate limits.
export async function psi(cfg, url) {
  const params = new URLSearchParams({ url, strategy: "mobile", category: "PERFORMANCE" });
  if (cfg.keys?.google) params.set("key", cfg.keys.google);
  const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`,
    { signal: AbortSignal.timeout(90000) });
  if (!res.ok) return { error: `PSI HTTP ${res.status}` };
  const body = await res.json();
  const lh = body.lighthouseResult || {};
  const audits = lh.audits || {};
  const perf = lh.categories?.performance?.score;
  const metric = (id) => audits[id]?.displayValue || "";
  const field = body.loadingExperience?.metrics || {};
  return {
    score: perf != null ? Math.round(perf * 100) : null,
    lcp: metric("largest-contentful-paint"),
    cls: metric("cumulative-layout-shift"),
    tbt: metric("total-blocking-time"),
    fieldOverall: (body.loadingExperience?.overall_category || "").toLowerCase(),
    fieldLcpMs: field.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null,
    link: `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(url)}`,
  };
}

export async function ahrefsDR(cfg, domain) {
  const res = await fetch(
    `https://api.ahrefs.com/v3/public/domain-rating-free?target=${encodeURIComponent(domain)}`,
    { headers: { Authorization: `Bearer ${cfg.keys.ahrefs}`, Accept: "application/json" },
      signal: AbortSignal.timeout(30000) });
  if (!res.ok) return { domain, error: `HTTP ${res.status}` };
  const body = await res.json();
  return { domain, dr: body.domain_rating?.domain_rating ?? null };
}
