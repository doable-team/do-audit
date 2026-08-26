// First-run onboarding: connect API keys interactively. Everything is stored
// locally in ~/.config/do-audit/config.json — keys never leave the machine
// except to call the APIs they belong to.
import { PROVIDERS, configuredProviders } from "./ai.js";
import { loadStored, saveStored, CONFIG_PATH } from "./config.js";
import { ask, confirm, closePrompts, bold, cyan, gray, green, yellow, maskKey, hr } from "./ui.js";

export async function onboard() {
  const cfg = loadStored();
  cfg.keys = cfg.keys || {};

  console.log(`  ${bold("Let's connect your API keys.")}
  ${gray("Keys are stored locally in " + CONFIG_PATH + " (never uploaded anywhere).")}
  ${gray("Press Enter to skip any key — you can add it later with: do-audit init")}\n`);

  // --- AI providers (at least one required) ---
  console.log(`  ${bold("1. AI providers")} ${gray("— power the analysis AND the AI-visibility tests.")}
  ${gray("Connect as many as you like: every connected platform gets tested for")}
  ${gray("whether AI assistants recommend this site. At least one is required.")}\n`);

  const ids = Object.keys(PROVIDERS);
  for (;;) {
    ids.forEach((id, i) => {
      const p = PROVIDERS[id];
      const st = cfg.keys[p.keyName] ? green("connected " + maskKey(cfg.keys[p.keyName])) : gray("not connected");
      console.log(`   ${cyan(String(i + 1).padStart(2))}. ${p.label.padEnd(20)} ${st}`);
    });
    const got = configuredProviders(cfg).length;
    const pick = await ask(`\n  Number to connect${got ? ", or Enter to continue:" : " (connect at least one):"}`);
    if (!pick) {
      if (got) break;
      console.log(yellow("  At least one AI provider is required.\n"));
      continue;
    }
    const id = ids[parseInt(pick, 10) - 1];
    if (!id) { console.log(yellow("  Invalid choice.\n")); continue; }
    const p = PROVIDERS[id];
    console.log(gray(`  Get a key: ${p.keyUrl}`));
    const key = await ask(`${p.label} API key:`, { secret: true });
    if (key) { cfg.keys[p.keyName] = key; console.log(green(`  ✓ ${p.label} connected\n`)); }
    else console.log();
  }

  const connected = configuredProviders(cfg);
  if (connected.length > 1) {
    console.log(`\n  Which provider should write the analysis? ${gray("(the audit narrative & scoring)")}`);
    connected.forEach((id, i) => console.log(`   ${cyan(String(i + 1))}. ${PROVIDERS[id].label}`));
    const pick = await ask("  Choice:", { def: "1" });
    cfg.analysisProvider = connected[parseInt(pick, 10) - 1] || connected[0];
  } else {
    cfg.analysisProvider = connected[0];
  }
  console.log(green(`  ✓ Analysis provider: ${PROVIDERS[cfg.analysisProvider].label}\n`));
  hr();

  // --- SEO data sources (all optional) ---
  console.log(`\n  ${bold("2. SEO data sources")} ${gray("— optional, but they unlock real ranking data.")}\n`);

  console.log(`  ${bold("DataForSEO")} ${gray("— keywords, live SERPs, competitors, backlinks.")}
  ${gray("Sign up: https://dataforseo.com — key format is login:password")}`);
  const dfsKey = await ask("DataForSEO key (login:password):",
    { secret: true, def: cfg.keys.dataforseo ? "keep current" : "" });
  if (dfsKey && dfsKey !== "keep current") cfg.keys.dataforseo = dfsKey;

  console.log(`\n  ${bold("Google API key")} ${gray("— lifts PageSpeed Insights rate limits (PSI works without it).")}
  ${gray("Get one: https://developers.google.com/speed/docs/insights/v5/get-started")}`);
  const gKey = await ask("Google API key:", { secret: true, def: cfg.keys.google ? "keep current" : "" });
  if (gKey && gKey !== "keep current") cfg.keys.google = gKey;

  console.log(`\n  ${bold("Ahrefs API key")} ${gray("— free domain-rating endpoint.")}
  ${gray("Get one: https://ahrefs.com/api")}`);
  const aKey = await ask("Ahrefs API key:", { secret: true, def: cfg.keys.ahrefs ? "keep current" : "" });
  if (aKey && aKey !== "keep current") cfg.keys.ahrefs = aKey;
  hr();

  // --- report preferences ---
  console.log(`\n  ${bold("3. Report preferences")} ${gray("(optional)")}\n`);
  const brand = await ask("Your brand/agency name for report headers (Enter for none):",
    { def: cfg.brand || "" });
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
