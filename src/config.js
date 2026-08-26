// Config storage: ~/.config/do-audit/config.json (created 0600).
// Environment variables always override the stored file.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CONFIG_DIR = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "do-audit");
export const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

export function loadStored() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")); } catch { return {}; }
}

export function saveStored(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
}

// Env var names honored per key (standard provider names + DO_AUDIT_ prefixes).
const ENV = {
  "keys.openai": ["OPENAI_API_KEY"],
  "keys.anthropic": ["ANTHROPIC_API_KEY"],
  "keys.gemini": ["GEMINI_API_KEY", "GOOGLE_GENAI_API_KEY"],
  "keys.perplexity": ["PERPLEXITY_API_KEY"],
  "keys.openrouter": ["OPENROUTER_API_KEY"],
  "keys.deepseek": ["DEEPSEEK_API_KEY"],
  "keys.groq": ["GROQ_API_KEY"],
  "keys.xai": ["XAI_API_KEY"],
  "keys.dataforseo": ["DATAFORSEO_KEY"],
  "keys.google": ["GOOGLE_API_KEY", "PAGESPEED_API_KEY"],
  "keys.ahrefs": ["AHREFS_API_KEY"],
  "analysisProvider": ["DO_AUDIT_ANALYSIS_PROVIDER"],
  "market": ["DO_AUDIT_MARKET"],
  "brand": ["DO_AUDIT_BRAND"],
};

const getPath = (obj, dotted) =>
  dotted.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);
const setPath = (obj, dotted, value) => {
  const parts = dotted.split(".");
  let o = obj;
  for (const p of parts.slice(0, -1)) o = o[p] = o[p] && typeof o[p] === "object" ? o[p] : {};
  o[parts.at(-1)] = value;
};

// Stored config merged with env overrides.
export function loadConfig() {
  const cfg = loadStored();
  for (const [dotted, envNames] of Object.entries(ENV)) {
    for (const name of envNames) {
      if (process.env[name]) { setPath(cfg, dotted, process.env[name]); break; }
    }
  }
  return cfg;
}

export function setConfigValue(dotted, value) {
  const cfg = loadStored();
  if (value === "" || value == null) {
    const parts = dotted.split(".");
    const parent = parts.slice(0, -1).reduce((o, k) => o?.[k], cfg);
    if (parent) delete parent[parts.at(-1)];
  } else {
    setPath(cfg, dotted, value);
  }
  saveStored(cfg);
}

export { getPath };
