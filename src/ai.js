// LLM provider adapters. One unified chat() across OpenAI-compatible APIs,
// Anthropic, and Gemini — used both for report analysis (chatJSON) and for
// AI-visibility testing (asking each configured model the same prompts).

export const PROVIDERS = {
  openai:     { label: "ChatGPT (OpenAI)",   keyName: "openai",     type: "openai",
                url: "https://api.openai.com/v1/chat/completions",     model: "gpt-4o-mini",
                keyUrl: "https://platform.openai.com/api-keys" },
  anthropic:  { label: "Claude (Anthropic)", keyName: "anthropic",  type: "anthropic",
                url: "https://api.anthropic.com/v1/messages",          model: "claude-sonnet-5",
                keyUrl: "https://console.anthropic.com/settings/keys" },
  gemini:     { label: "Gemini (Google)",    keyName: "gemini",     type: "gemini",
                model: "gemini-2.5-flash",
                keyUrl: "https://aistudio.google.com/apikey" },
  perplexity: { label: "Perplexity",         keyName: "perplexity", type: "openai", jsonMode: false, web: true,
                url: "https://api.perplexity.ai/chat/completions",     model: "sonar",
                keyUrl: "https://www.perplexity.ai/settings/api" },
  openrouter: { label: "OpenRouter",         keyName: "openrouter", type: "openai",
                url: "https://openrouter.ai/api/v1/chat/completions",  model: "deepseek/deepseek-chat",
                keyUrl: "https://openrouter.ai/keys" },
  deepseek:   { label: "DeepSeek",           keyName: "deepseek",   type: "openai",
                url: "https://api.deepseek.com/chat/completions",      model: "deepseek-chat",
                keyUrl: "https://platform.deepseek.com/api_keys" },
  groq:       { label: "Groq",               keyName: "groq",       type: "openai",
                url: "https://api.groq.com/openai/v1/chat/completions", model: "llama-3.3-70b-versatile",
                keyUrl: "https://console.groq.com/keys" },
  xai:        { label: "Grok (xAI)",         keyName: "xai",        type: "openai",
                url: "https://api.x.ai/v1/chat/completions",           model: "grok-3-mini",
                keyUrl: "https://console.x.ai" },
};

export const configuredProviders = (cfg) =>
  Object.keys(PROVIDERS).filter((id) => cfg.keys?.[PROVIDERS[id].keyName]);

const modelFor = (cfg, id) => cfg.models?.[id] || PROVIDERS[id].model;

// Ask one provider. Returns { text, cited:[urls] }.
// With web:true the provider's live web search is enabled where supported
// (OpenAI search models, Anthropic web_search tool, Gemini Google-Search
// grounding, OpenRouter :online, xAI Live Search; Perplexity always searches).
// This matters for AI-visibility testing: without search, models can only
// mention brands they memorized in training.
export async function chat(cfg, id, system, user, { maxTokens = 1200, json = false, web = false } = {}) {
  const p = PROVIDERS[id];
  if (!p) throw new Error(`Unknown provider: ${id}`);
  const key = cfg.keys?.[p.keyName];
  if (!key) throw new Error(`No API key configured for ${p.label}`);
  let model = modelFor(cfg, id);

  if (p.type === "anthropic") {
    const res = await fetch(p.url, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model, max_tokens: maxTokens, system,
        messages: [{ role: "user", content: user }],
        ...(web ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }] } : {}) }),
    });
    if (!res.ok) throw new Error(`${p.label} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    const cited = [];
    for (const b of body.content || []) {
      for (const c of b.citations || []) if (c.url) cited.push(c.url);
      if (Array.isArray(b.content)) for (const r of b.content) if (r.url) cited.push(r.url);
    }
    return { text: (body.content || []).filter((b) => b.type === "text")
      .map((b) => b.text || "").join(""), cited };
  }

  if (p.type === "gemini") {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: user }] }],
          systemInstruction: { parts: [{ text: system }] },
          ...(web ? { tools: [{ google_search: {} }] } : {}),
          generationConfig: { maxOutputTokens: maxTokens,
            ...(json && !web ? { responseMimeType: "application/json" } : {}) },
        }),
      });
    if (!res.ok) throw new Error(`${p.label} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    const cand = body.candidates?.[0];
    const cited = (cand?.groundingMetadata?.groundingChunks || [])
      .map((c) => c.web?.uri).filter(Boolean);
    return { text: (cand?.content?.parts || []).map((x) => x.text || "").join(""), cited };
  }

  // OpenAI-compatible (OpenAI, Perplexity, OpenRouter, DeepSeek, Groq, xAI)
  if (web) {
    // OpenAI's web search lives in dedicated search models; keep a custom
    // model if the user already chose a search variant.
    if (id === "openai" && !/search/.test(model)) model = "gpt-4o-mini-search-preview";
    if (id === "openrouter" && !model.endsWith(":online")) model = model + ":online";
  }
  const res = await fetch(p.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json",
      ...(id === "openrouter" ? { "HTTP-Referer": "https://github.com/doable-team/do-audit",
        "X-Title": "do-audit CLI" } : {}) },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      max_tokens: maxTokens,
      ...(web && id === "openai" ? { web_search_options: {} } : {}),
      ...(web && id === "xai" ? { search_parameters: { mode: "auto", return_citations: true } } : {}),
      ...(json && p.jsonMode !== false && !web ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`${p.label} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  const cited = [...(body.citations || []),
    ...((body.choices?.[0]?.message?.annotations || [])
      .map((a) => a.url_citation?.url).filter(Boolean))];
  return { text: body.choices?.[0]?.message?.content || "", cited };
}

// Attempt to fix the malformed JSON LLMs commonly emit: markdown fences,
// trailing commas, missing commas, and output truncated mid-structure.
export function repairJSON(text) {
  let t = String(text || "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.search(/[{[]/);
  if (start > 0) t = t.slice(start);
  t = t.replace(
    /("(?:[^"\\]|\\.)*"|\d|true|false|null|\}|\])(\s*\n\s*)(["{[]|\d|-|true|false|null)/g,
    "$1,$2$3",
  );
  t = t.replace(/,(\s*[}\]])/g, "$1");
  try { return JSON.parse(t); } catch {}
  const closeAndParse = (s) => {
    const stack = [];
    let inStr = false, esc = false;
    for (const ch of s) {
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
      else if (ch === "}" || ch === "]") stack.pop();
    }
    if (inStr) return null;
    const cut = s.replace(/[,:\s]+$/, "");
    try { return JSON.parse(cut + stack.reverse().join("")); } catch { return null; }
  };
  let s = t;
  for (let i = 0; i < 200 && s.length > 1; i++) {
    const parsed = closeAndParse(s);
    if (parsed) return parsed;
    const chop = Math.max(s.lastIndexOf(","), s.lastIndexOf("{"), s.lastIndexOf("["), s.lastIndexOf('"'));
    if (chop <= 0) break;
    s = s.slice(0, chop);
  }
  return null;
}

// Structured-output call against the configured analysis provider, with one
// retry at a larger budget when the JSON comes back broken.
export async function chatJSON(cfg, system, user, maxTokens = 6000) {
  const id = cfg.analysisProvider && cfg.keys?.[PROVIDERS[cfg.analysisProvider]?.keyName]
    ? cfg.analysisProvider : configuredProviders(cfg)[0];
  if (!id) throw new Error("No AI provider configured. Run: do-audit init");
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { text } = await chat(cfg, id,
      system + " Output ONLY a single valid JSON object — no markdown, no commentary.",
      user, { maxTokens: attempt === 0 ? maxTokens : Math.round(maxTokens * 1.5), json: true });
    try { return JSON.parse(text); } catch {}
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch {} }
    const repaired = repairJSON(text);
    if (repaired) return repaired;
    lastErr = new Error(`${PROVIDERS[id].label} returned unparseable JSON (${text.length} chars)`);
  }
  throw lastErr;
}

// Run limited-concurrency tasks.
export async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = await fn(items[idx], idx); }
      catch (e) { results[idx] = { error: String(e.message || e) }; }
    }
  });
  await Promise.all(workers);
  return results;
}

// AI-visibility testing: ask every configured provider each prompt, then check
// whether the brand/domain is mentioned or cited in the answer.
export async function visibilityTests(cfg, prompts, brand, domain, onProgress) {
  const ids = configuredProviders(cfg);
  const combos = [];
  for (const prompt of prompts) for (const id of ids) combos.push({ prompt, id });
  let done = 0;
  const results = await pool(combos, 3, async ({ prompt, id }) => {
    const { text, cited } = await chat(cfg, id,
      "You are a helpful assistant. Answer naturally, as you would for a real user. " +
      "Name specific companies, products or websites where relevant.",
      prompt.prompt || prompt, { maxTokens: 700, web: true });
    onProgress?.(++done, combos.length);
    const hay = (text || "").toLowerCase();
    const mentioned = hay.includes(String(brand).toLowerCase()) || hay.includes(domain.toLowerCase());
    const citedSite = (cited || []).some((u) => u.includes(domain));
    return { platform: PROVIDERS[id].label, provider: id,
      prompt: prompt.prompt || prompt, category: prompt.category || "",
      mentioned: mentioned || citedSite, cited: citedSite,
      excerpt: (text || "").slice(0, 500) };
  });
  return results.filter((r) => r && !r.error);
}
