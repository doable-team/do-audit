// Terminal UI helpers: colors, spinner, prompts. Zero dependencies.
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

// Where human-readable output goes. Agent mode (`--agent`) redirects it to
// stderr so stdout carries nothing but the JSON payload.
let sink = stdout;
export function setLogSink(stream) { sink = stream; }
export const say = (line = "") => sink.write(line + "\n");

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
  say(`
  ${c.cyan}${c.bold}do-audit${c.reset}${version ? gray(" v" + version) : ""}
  ${gray("Open-source SEO audit — technical · on-page · keywords · authority · AI visibility")}
`);
}

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class Spinner {
  constructor() { this.timer = null; this.text = ""; }
  start(text) {
    this.text = text;
    if (!sink.isTTY) { say("  … " + text); return this; }
    let i = 0;
    this.stop(false);
    this.timer = setInterval(() => {
      sink.write(`\r  ${c.cyan}${FRAMES[i = (i + 1) % FRAMES.length]}${c.reset} ${this.text}\x1b[K`);
    }, 80);
    return this;
  }
  update(text) { this.text = text; if (!sink.isTTY) say("  … " + text); }
  stop(print = false) {
    if (this.timer) { clearInterval(this.timer); this.timer = null; if (sink.isTTY) sink.write("\r\x1b[K"); }
    if (print) say(print);
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

// Arrow-key menu: ↑/↓ (or j/k/Tab) to move, Enter to choose, 1-9 to jump.
// items: [{label, hint?}]. Resolves to the chosen index.
// Falls back to a numbered prompt when stdin isn't a TTY.
export async function select(title, items, { initial = 0 } = {}) {
  if (!stdin.isTTY) {
    console.log("  " + bold(title));
    items.forEach((it, i) =>
      console.log(`   ${i + 1}. ${it.label}${it.hint ? "  " + gray(it.hint) : ""}`));
    const a = await ask(`Choice [1-${items.length}]:`, { def: String(initial + 1) });
    const n = parseInt(a, 10);
    return Math.min(Math.max(1, n || initial + 1), items.length) - 1;
  }
  return new Promise((resolve) => {
    let idx = Math.min(Math.max(0, initial), items.length - 1);
    const render = (first) => {
      if (!first) stdout.write(`\x1b[${items.length + 1}A`);
      stdout.write("\r\x1b[J  " + bold(title) + "\n");
      items.forEach((it, i) => {
        const cur = i === idx;
        stdout.write((cur ? cyan("  ❯ ") : "    ") +
          (cur ? c.bold + it.label + c.reset : it.label) +
          (it.hint ? "  " + gray(it.hint) : "") + "\n");
      });
    };
    const wasRaw = !!stdin.isRaw;
    if (rl) rl.pause();
    stdin.setRawMode(true);
    stdin.resume();
    render(true);
    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      if (rl) rl.resume();
    };
    let escBuf = "";
    const onData = (buf) => {
      let s = buf.toString();
      // Escape sequences can arrive split across reads — reassemble them.
      if (escBuf) { s = escBuf + s; escBuf = ""; }
      if (s === "\x1b" || s === "\x1b[") { escBuf = s; return; }
      if (s === "\x1b[A" || s === "k") idx = (idx - 1 + items.length) % items.length;
      else if (s === "\x1b[B" || s === "j" || s === "\t") idx = (idx + 1) % items.length;
      else if (s === "\r" || s === "\n") { cleanup(); return resolve(idx); }
      else if (/^[1-9]$/.test(s) && parseInt(s, 10) <= items.length) {
        idx = parseInt(s, 10) - 1; render(false);
        cleanup(); return resolve(idx);
      }
      else if (s === "\x03" || s === "\x1b") {
        if (s === "\x03") { cleanup(); stdout.write("\n"); process.exit(130); }
        return; // bare Esc: ignore (avoid clashing with arrow-key prefixes)
      }
      render(false);
    };
    stdin.on("data", onData);
  });
}

export const maskKey = (k) =>
  !k ? gray("not set") : k.length <= 8 ? "••••" : k.slice(0, 4) + "…" + k.slice(-4);

export function hr() { console.log(gray("  " + "─".repeat(56))); }
