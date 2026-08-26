// Terminal UI helpers: colors, spinner, prompts. Zero dependencies.
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

const TTY = stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb";
const code = (n) => (TTY ? `\x1b[${n}m` : "");

export const c = {
  reset: code(0), bold: code(1), dim: code(2),
  red: code(31), green: code(32), yellow: code(33), blue: code(34),
  magenta: code(35), cyan: code(36), gray: code(90), white: code(97),
};
export const bold = (s) => c.bold + s + c.reset;
export const dim = (s) => c.dim + s + c.reset;
export const green = (s) => c.green + s + c.reset;
export const red = (s) => c.red + s + c.reset;
export const yellow = (s) => c.yellow + s + c.reset;
export const cyan = (s) => c.cyan + s + c.reset;
export const gray = (s) => c.gray + s + c.reset;

export function banner(version) {
  console.log(`
  ${c.cyan}${c.bold}do-audit${c.reset}${version ? gray(" v" + version) : ""}
  ${gray("Open-source SEO audit — technical · on-page · keywords · authority · AI visibility")}
`);
}

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class Spinner {
  constructor() { this.timer = null; this.text = ""; }
  start(text) {
    this.text = text;
    if (!stdout.isTTY) { console.log("  … " + text); return this; }
    let i = 0;
    this.stop(false);
    this.timer = setInterval(() => {
      stdout.write(`\r  ${c.cyan}${FRAMES[i = (i + 1) % FRAMES.length]}${c.reset} ${this.text}\x1b[K`);
    }, 80);
    return this;
  }
  update(text) { this.text = text; if (!stdout.isTTY) console.log("  … " + text); }
  stop(print = false) {
    if (this.timer) { clearInterval(this.timer); this.timer = null; if (stdout.isTTY) stdout.write("\r\x1b[K"); }
    if (print) console.log(print);
  }
  ok(text) { this.stop(`  ${green("✓")} ${text}`); }
  warn(text) { this.stop(`  ${yellow("!")} ${text}`); }
  fail(text) { this.stop(`  ${red("✗")} ${text}`); }
}

let rl = null;
function ensureRl() {
  if (!rl) rl = readline.createInterface({ input: stdin, output: stdout });
  return rl;
}
export async function ask(question, { def = "", secret = false } = {}) {
  const r = ensureRl();
  const suffix = def ? gray(` (${def})`) : "";
  let answer;
  if (secret && stdin.isTTY) {
    const orig = r._writeToOutput?.bind(r);
    r._writeToOutput = (s) => {
      if (s.includes("\n") || !r.line) stdout.write(s.replace(r.line || "", "•".repeat((r.line || "").length)));
      else stdout.write("\r\x1b[K  " + question + suffix + " " + "•".repeat(r.line.length));
    };
    answer = await r.question("  " + question + suffix + " ");
    if (orig) r._writeToOutput = orig; else delete r._writeToOutput;
    stdout.write("\n");
  } else {
    answer = await r.question("  " + question + suffix + " ");
  }
  return (answer || "").trim() || def;
}
export async function confirm(question, def = true) {
  const a = (await ask(`${question} ${gray(def ? "[Y/n]" : "[y/N]")}`)).toLowerCase();
  if (!a) return def;
  return a.startsWith("y");
}
export function closePrompts() { if (rl) { rl.close(); rl = null; } }

export const maskKey = (k) =>
  !k ? gray("not set") : k.length <= 8 ? "••••" : k.slice(0, 4) + "…" + k.slice(-4);

export function hr() { console.log(gray("  " + "─".repeat(56))); }
