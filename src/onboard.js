// First-run onboarding: connect API keys interactively. Everything is stored
// locally in ~/.config/do-audit/config.json — keys never leave the machine
// except to call the APIs they belong to.
import { PROVIDERS, configuredProviders } from "./ai.js";
import { loadStored, saveStored, CONFIG_PATH } from "./config.js";
import { ask, select, closePrompts, bold, cyan, gray, green, yellow, maskKey, hr } from "./ui.js";

export async function onboard() {
  const cfg = loadStored();
  cfg.keys = cfg.keys || {};
  cfg.models = cfg.models || {};

  console.log(`  ${bold("Let's connect your API keys.")}
  ${gray("Keys are stored locally in " + CONFIG_PATH + " (never uploaded anywhere).")}\n`);

  // --- 1. AI providers (at least one required) ---
  console.log(`  ${bold("1. AI providers")} ${gray("— power the analysis AND the AI-visibility tests.")}
  ${gray("Connect as many as you like: every connected platform gets tested for")}
  ${gray("whether AI assistants recommend this site. At least one is required.")}\n`);

  const ids = Object.keys(PROVIDERS);
  let cursor = 0;
  for (;;) {
    const got = configuredProviders(cfg).length;
    const items = ids.map((id) => {
      const p = PROVIDERS[id];
      const model = cfg.models[id] || p.model;
      return { label: p.label,
        hint: cfg.keys[p.keyName]
          ? green("connected") + gray(` ${maskKey(cfg.keys[p.keyName])} · ${model}`)
          : gray("not connected") };
    });
    items.push(got
      ? { label: "Done — continue", hint: gray(`${got} provider${got > 1 ? "s" : ""} connected`) }
      : { label: gray("Done (connect at least one provider first)") });
    const idx = await select("Pick a provider to connect (↑/↓ + Enter):", items, { initial: cursor });
    if (idx === items.length - 1) {
      if (got) break;
      console.log(yellow("\n  At least one AI provider is required.\n"));
      continue;
    }
    cursor = idx;
    const id = ids[idx];
    const p = PROVIDERS[id];
    console.log(`\n  ${bold(p.label)} ${gray("— get a key: " + p.keyUrl)}`);
    const key = await ask(`API key ${cfg.keys[p.keyName] ? gray("(Enter = keep current)") + ":" : ":"}`,
      { secret: true });
    if (key) cfg.keys[p.keyName] = key;
    if (key || cfg.keys[p.keyName]) {
      const model = await ask(`Model:`, { def: cfg.models[id] || p.model });
      if (model && model !== p.model) cfg.models[id] = model;
      else delete cfg.models[id];
      console.log(green(`  ✓ ${p.label} connected`) + gray(` · ${model || p.model}`) + "\n");
    } else console.log();
  }

  const connected = configuredProviders(cfg);
  if (connected.length > 1) {
    console.log();
    const pick = await select("Which provider should write the analysis? (the audit narrative & scoring)",
      connected.map((id) => ({ label: PROVIDERS[id].label,
        hint: gray(cfg.models[id] || PROVIDERS[id].model) })),
      { initial: Math.max(0, connected.indexOf(cfg.analysisProvider)) });
    cfg.analysisProvider = connected[pick];
  } else {
    cfg.analysisProvider = connected[0];
  }
  console.log(green(`\n  ✓ Analysis provider: ${PROVIDERS[cfg.analysisProvider].label}\n`));
  hr();

  // --- 2. SEO data sources (all optional, skippable in one go) ---
  console.log(`\n  ${bold("2. SEO data sources")} ${gray("— optional. They unlock real ranking data;")}
  ${gray("without them you still get crawl, performance, AI visibility and the full report.")}\n`);
  const dataChoice = await select("Connect optional data sources?", [
    { label: "Yes — connect DataForSEO / Google / Ahrefs",
      hint: gray("keywords, live SERPs, competitors, backlinks, DR") },
    { label: "Skip all — AI-only audit",
      hint: gray("add them anytime later with: do-audit init") },
  ], { initial: cfg.keys.dataforseo || cfg.keys.google || cfg.keys.ahrefs ? 0 : 1 });

  if (dataChoice === 0) {
    console.log(`\n  ${bold("DataForSEO")} ${gray("— keywords, live SERPs, competitors, backlinks.")}
  ${gray("Sign up: https://dataforseo.com — key format is login:password. Enter to skip.")}`);
    const dfsKey = await ask("DataForSEO key (login:password):",
      { secret: true, def: cfg.keys.dataforseo ? "keep current" : "" });
    if (dfsKey && dfsKey !== "keep current") cfg.keys.dataforseo = dfsKey;

    console.log(`\n  ${bold("Google API key")} ${gray("— lifts PageSpeed Insights rate limits (PSI works without it).")}
  ${gray("Get one: https://developers.google.com/speed/docs/insights/v5/get-started. Enter to skip.")}`);
    const gKey = await ask("Google API key:", { secret: true, def: cfg.keys.google ? "keep current" : "" });
    if (gKey && gKey !== "keep current") cfg.keys.google = gKey;

    console.log(`\n  ${bold("Ahrefs API key")} ${gray("— free domain-rating endpoint.")}
  ${gray("Get one: https://ahrefs.com/api. Enter to skip.")}`);
    const aKey = await ask("Ahrefs API key:", { secret: true, def: cfg.keys.ahrefs ? "keep current" : "" });
    if (aKey && aKey !== "keep current") cfg.keys.ahrefs = aKey;
  } else {
    console.log(gray("\n  Skipped — running AI-only audits. Add data sources later with: do-audit init"));
  }
  hr();

  // --- 3. report preferences ---
  console.log(`\n  ${bold("3. Report preferences")} ${gray("(optional — Enter to skip)")}\n`);
  const brand = await ask("Your brand/agency name for report headers:", { def: cfg.brand || "" });
  if (brand) cfg.brand = brand;
  const market = (await ask("Default target market, ISO code like US, GB, IN (Enter = auto-detect):",
    { def: cfg.market || "" })).toUpperCase();
  if (market) cfg.market = market;

  saveStored(cfg);
  closePrompts();
  console.log(`
  ${green("✓ Setup complete.")} Config saved to ${cyan(CONFIG_PATH)}

  Run your first audit:

    ${bold(cyan("do-audit example.com"))}
`);
  return cfg;
}

export async function maybeOnboard(cfg) {
  if (configuredProviders(cfg).length) return cfg;
  console.log(`  ${yellow("No AI provider configured yet — let's set up first.")}\n`);
  return onboard();
}
