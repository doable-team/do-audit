// CLI entry: command routing and flags.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, loadStored, setConfigValue, CONFIG_PATH } from "./config.js";
import { PROVIDERS, configuredProviders } from "./ai.js";
import { onboard, maybeOnboard } from "./onboard.js";
import { runAudit, saveReportFiles, openInBrowser } from "./audit.js";
import { banner, bold, cyan, gray, green, yellow, maskKey, ask, select, closePrompts } from "./ui.js";

const VERSION = JSON.parse(fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")).version;

const HELP = `
  ${bold("Usage")}

    do-audit <domain>            Run a full SEO audit — results render in the
                                 terminal, then a menu: save as HTML, audit
                                 another site, or exit
    do-audit edit [report.html]  Edit a report in the browser (local server,
                                 rich text, drag sections, version history)
    do-audit init                Connect / update API keys (interactive)
    do-audit config              Show configuration status
    do-audit config set <k> <v>  Set a config value (e.g. keys.openai sk-…)
    do-audit config path         Print the config file path

  ${bold("Flags")}

    --open           Auto-save the HTML report and open it in your browser
    --out <file>     Auto-save to this path (default: ./audit-<domain>-<date>.html)
    --market <ISO>   Target market, e.g. US, GB, IN (default: auto-detected)
    --pages <n>      Extra internal pages to crawl (default: 4)
    --json           Also write the raw collected data as JSON
    -v, --version    Print version
    -h, --help       Show this help

  ${bold("Examples")}

    do-audit example.com --open
    do-audit example.com --market GB --json
    npx do-audit example.com

  ${gray("Docs & source: https://github.com/doable-team/do-audit")}
`;

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--open") opts.open = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--out") opts.out = argv[++i];
    else if (a === "--market") opts.market = argv[++i];
    else if (a === "--pages") opts.pages = parseInt(argv[++i], 10);
    else if (a === "-v" || a === "--version") opts.version = true;
    else if (a === "-h" || a === "--help") opts.help = true;
    else opts._.push(a);
  }
  return opts;
}

const cleanDomain = (input) =>
  String(input || "").trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[\/?#].*$/, "").toLowerCase();

export async function run(argv) {
  const opts = parseArgs(argv);
  if (opts.version) { console.log(VERSION); return; }
  const [cmd, ...rest] = opts._;

  if (opts.help || !cmd) { banner(VERSION); console.log(HELP); closePrompts(); return; }

  if (cmd === "init") { banner(VERSION); await onboard(); return; }

  if (cmd === "edit") {
    let file = rest[0];
    if (!file) {
      // Default to the newest audit report in the current directory.
      file = fs.readdirSync(".")
        .filter((f) => /^audit-.*\.html$/.test(f) && !/-notes\.html$/.test(f))
        .map((f) => ({ f, t: fs.statSync(f).mtimeMs }))
        .sort((a, b) => b.t - a.t)[0]?.f;
      if (!file) throw new Error("No audit-*.html report found here. Usage: do-audit edit <report.html>");
    }
    file = path.resolve(file);
    if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
    const { startEditServer } = await import("./editor.js");
    const { url } = await startEditServer(file);
    banner(VERSION);
    console.log(`  Editing ${cyan(path.basename(file))}
  ${bold("Editor:")}  ${cyan(url + "/edit")}
  ${bold("Preview:")} ${cyan(url + "/")}
  ${gray("Save writes directly to the file; versions are kept in " + path.basename(file) + ".versions/")}
  ${gray("Local only (127.0.0.1) — press Ctrl+C to stop.")}\n`);
    const { spawn } = await import("node:child_process");
    const opener = process.platform === "darwin" ? "open"
      : process.platform === "win32" ? "start" : "xdg-open";
    spawn(opener, [url + "/edit"], { detached: true, stdio: "ignore",
      shell: process.platform === "win32" }).unref();
    return new Promise(() => {}); // keep the server alive until Ctrl+C
  }

  if (cmd === "config") {
    const sub = rest[0];
    if (sub === "path") { console.log(CONFIG_PATH); return; }
    if (sub === "set") {
      const [key, ...valueParts] = rest.slice(1);
      if (!key) throw new Error("Usage: do-audit config set <key> <value>   (e.g. keys.openai sk-…)");
      setConfigValue(key, valueParts.join(" "));
      console.log(green(`  ✓ ${key} ${valueParts.length ? "set" : "cleared"}`));
      return;
    }
    banner(VERSION);
    const cfg = loadConfig();
    const stored = loadStored();
    console.log(`  ${bold("Config")} ${gray(CONFIG_PATH)}\n`);
    console.log(`  ${bold("AI providers")}`);
    for (const [id, p] of Object.entries(PROVIDERS)) {
      const mark = cfg.analysisProvider === id && cfg.keys?.[p.keyName] ? cyan(" ← analysis") : "";
      console.log(`   ${p.label.padEnd(20)} ${maskKey(cfg.keys?.[p.keyName])}${mark}`);
    }
    console.log(`\n  ${bold("Data sources")}`);
    console.log(`   ${"DataForSEO".padEnd(20)} ${maskKey(cfg.keys?.dataforseo)}`);
    console.log(`   ${"Google (PageSpeed)".padEnd(20)} ${maskKey(cfg.keys?.google)}`);
    console.log(`   ${"Ahrefs".padEnd(20)} ${maskKey(cfg.keys?.ahrefs)}`);
    console.log(`\n  ${bold("Preferences")}`);
    console.log(`   ${"Brand".padEnd(20)} ${stored.brand || gray("none")}`);
    console.log(`   ${"Default market".padEnd(20)} ${stored.market || gray("auto-detect")}`);
    console.log(`\n  ${gray("Update anything with: do-audit init")}\n`);
    return;
  }

  // Anything else is treated as a domain to audit.
  const domain = cleanDomain(cmd === "audit" ? rest[0] : cmd);
  if (!domain || !domain.includes(".")) {
    throw new Error(`"${cmd}" is not a command or a valid domain. Try: do-audit example.com  (or --help)`);
  }
  banner(VERSION);
  let cfg = loadConfig();
  if (!configuredProviders(cfg).length) { cfg = await maybeOnboard(cfg); cfg = loadConfig(); }
  await auditFlow(cfg, domain, opts);
  closePrompts();
}

const promoLine = () =>
  console.log(`\n  ${gray("Fixing this is a workflow —")} ${bold("Visibility.so")} ${gray("runs SEO with human + AI agent teams:")}
  ${cyan("https://visibility.so/?utm_source=do-audit&utm_medium=cli&utm_campaign=oss-cli")}\n`);

// The interactive session: audit → results in the terminal → menu
// (save HTML / open / audit another site / exit) → loop.
async function auditFlow(cfg, domain, opts) {
  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  for (;;) {
    const { d, warnings } = await runAudit(cfg, domain, opts);
    let saved = null;
    if (opts.out || opts.open || opts.json || !interactive) {
      saved = saveReportFiles(cfg, d, warnings, opts);
      console.log(`  ${green("✓")} Report: ${cyan(saved.outFile)}
  ${green("✓")} Notes:  ${cyan(saved.notesFile)}${saved.jsonFile ? `\n  ${green("✓")} Data:   ${cyan(saved.jsonFile)}` : ""}`);
      if (opts.open) openInBrowser(saved.outFile);
    }
    if (!interactive) { promoLine(); return; }

    for (;;) {
      const items = saved
        ? [{ label: "Open report in browser", hint: gray(path.basename(saved.outFile)) }]
        : [{ label: "Get report as HTML", hint: gray("save the designed report + internal notes") }];
      items.push({ label: "Audit another site" }, { label: "Exit" });
      console.log();
      const pick = await select("What would you like to do next?", items);
      const label = items[pick].label;
      if (label === "Get report as HTML") {
        saved = saveReportFiles(cfg, d, warnings, opts);
        console.log(`\n  ${green("✓")} Report saved: ${cyan(saved.outFile)}
  ${green("✓")} Internal notes: ${cyan(saved.notesFile)}
  ${gray("Edit it anytime with: do-audit edit " + path.basename(saved.outFile))}`);
      } else if (label === "Open report in browser") {
        openInBrowser(saved.outFile);
        console.log(gray("\n  Opened in browser."));
      } else if (label === "Audit another site") {
        const next = cleanDomain(await ask("Domain to audit:"));
        if (!next || !next.includes(".")) { console.log(yellow("  Not a valid domain.")); continue; }
        domain = next;
        console.log();
        break; // back to the outer loop → run the next audit
      } else {
        promoLine();
        return;
      }
    }
  }
}
