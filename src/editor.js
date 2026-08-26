// Local in-place report editor — the audit agent's /:slug/edit, ported to a
// localhost-only server. 'do-audit edit <report.html>' serves the report with
// the same editor chrome (rich text, drag-to-reorder sections, tables/images,
// version history); Save writes straight back to the file on disk and every
// save/restore snapshots the outgoing version into <report>.versions/.
// Everything injected carries the __edit-x class and is stripped on save.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

export function injectEditor(html) {
  const i = html.lastIndexOf("</body>");
  return i === -1 ? html + CHROME : html.slice(0, i) + CHROME + html.slice(i);
}

// ---- on-disk version store: <report>.versions/{orig.html,<ts>.html,index.json} ----
const MAX_VERSIONS = 20;
const vdir = (file) => file + ".versions";
const readIndex = (file) => {
  try { return JSON.parse(fs.readFileSync(path.join(vdir(file), "index.json"), "utf8")); }
  catch { return []; }
};
const writeIndex = (file, index) =>
  fs.writeFileSync(path.join(vdir(file), "index.json"), JSON.stringify(index, null, 2));

export function saveVersion(file, html) {
  fs.mkdirSync(vdir(file), { recursive: true });
  const index = readIndex(file);
  const id = String(Date.now());
  fs.writeFileSync(path.join(vdir(file), id + ".html"), html);
  index.unshift({ id, size: html.length });
  while (index.length > MAX_VERSIONS) {
    const old = index.pop();
    try { fs.unlinkSync(path.join(vdir(file), old.id + ".html")); } catch {}
  }
  writeIndex(file, index);
}

export function listVersions(file) {
  return { versions: readIndex(file),
    hasOrig: fs.existsSync(path.join(vdir(file), "orig.html")) };
}

export function getVersion(file, id) {
  if (!/^(orig|\d+)$/.test(String(id))) return null;
  try { return fs.readFileSync(path.join(vdir(file), id + ".html"), "utf8"); }
  catch { return null; }
}

function ensureOrig(file, current) {
  fs.mkdirSync(vdir(file), { recursive: true });
  const orig = path.join(vdir(file), "orig.html");
  if (!fs.existsSync(orig)) fs.writeFileSync(orig, current);
}

// ---- localhost editor server (same routes the editor chrome expects) ----
export function startEditServer(file, { port = 4810 } = {}) {
  const readBody = (req) => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length;
      if (size > 12_000_000) { reject(new Error("payload too large")); req.destroy(); }
      else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
  const send = (res, status, body, type = "application/json") => {
    res.writeHead(status, { "Content-Type": type + "; charset=utf-8" });
    res.end(body);
  };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const p = url.pathname.replace(/\/+$/, "") || "/";
      const current = () => fs.readFileSync(file, "utf8");
      if (req.method === "GET" && p === "/") return send(res, 200, current(), "text/html");
      if (req.method === "GET" && p === "/edit") return send(res, 200, injectEditor(current()), "text/html");
      if (req.method === "GET" && p === "/edit/versions") return send(res, 200, JSON.stringify(listVersions(file)));
      if (req.method === "GET" && p === "/edit/version") {
        const v = getVersion(file, url.searchParams.get("id") || "");
        return v ? send(res, 200, v, "text/html") : send(res, 404, "<h1>Version not found</h1>", "text/html");
      }
      if (req.method === "POST" && (p === "/edit" || p === "/edit/reset" || p === "/edit/restore")) {
        const cur = current();
        if (p === "/edit/reset" || p === "/edit/restore") {
          let id = "orig";
          if (p === "/edit/restore") {
            try { id = String(JSON.parse(await readBody(req))?.id || ""); } catch { id = ""; }
          }
          const v = getVersion(file, id);
          if (!v) return send(res, 404, JSON.stringify({ error: "version not found" }));
          saveVersion(file, cur);
          fs.writeFileSync(file, v);
          return send(res, 200, JSON.stringify({ ok: true }));
        }
        let body;
        try { body = JSON.parse(await readBody(req)); }
        catch { return send(res, 400, JSON.stringify({ error: "send JSON: {html}" })); }
        const edited = String(body?.html || "");
        if (!edited.includes("</html>") || edited.length > 12_000_000) {
          return send(res, 400, JSON.stringify({ error: "invalid html payload" }));
        }
        ensureOrig(file, cur);
        saveVersion(file, cur);
        fs.writeFileSync(file, edited);
        return send(res, 200, JSON.stringify({ ok: true }));
      }
      send(res, 404, JSON.stringify({ error: "not found" }));
    } catch (e) {
      send(res, 500, JSON.stringify({ error: String(e.message || e) }));
    }
  });
  return new Promise((resolve) => {
    server.on("error", () => server.listen(0, "127.0.0.1"));
    server.listen(port, "127.0.0.1", () =>
      resolve({ server, url: "http://127.0.0.1:" + server.address().port }));
  });
}

const CHROME = `
<style id="__edit-css" class="__edit-x">
:root{--eui-bg:rgba(9,18,44,.86);--eui-line:rgba(255,255,255,.13);--eui-line2:rgba(255,255,255,.07);
--eui-txt:#dfe8ff;--eui-dim:#8fa0c9;--eui-hi:rgba(255,255,255,.09);--eui-hi2:rgba(255,255,255,.16);
--eui-blue:#0094ff;--eui-sky:#4cc2ff;--eui-shadow:0 18px 50px rgba(2,8,30,.55),0 2px 8px rgba(2,8,30,.35),inset 0 1px 0 rgba(255,255,255,.09)}
@keyframes __eui-up{from{opacity:0;transform:translate(-50%,10px)}to{opacity:1;transform:translate(-50%,0)}}
@keyframes __eui-dn{from{opacity:0;transform:translate(-50%,-10px)}to{opacity:1;transform:translate(-50%,0)}}
@keyframes __eui-pop{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
#__edit-fmt,#__edit-ui,#__edit-hist,.__edit-handle{font-family:'Manrope',system-ui,sans-serif;
-webkit-font-smoothing:antialiased;backdrop-filter:blur(20px) saturate(1.5);-webkit-backdrop-filter:blur(20px) saturate(1.5)}
/* ---------- formatting bar ---------- */
#__edit-fmt{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-wrap:wrap;
justify-content:center;align-items:center;gap:2px;background:var(--eui-bg);border:1px solid var(--eui-line);
border-radius:16px;padding:6px;max-width:min(96vw,880px);box-shadow:var(--eui-shadow);animation:__eui-dn .4s cubic-bezier(.22,.8,.35,1)}
#__edit-fmt button{display:grid;place-items:center;border:0;border-radius:9px;width:34px;height:32px;cursor:pointer;
color:var(--eui-txt);background:transparent;transition:background .15s,color .15s,transform .06s}
#__edit-fmt button:hover{background:var(--eui-hi2)}
#__edit-fmt button:active{transform:scale(.93)}
#__edit-fmt button.on{background:linear-gradient(140deg,#0094ff38,#4cc2ff26);color:#7fd4ff;box-shadow:inset 0 0 0 1px #4cc2ff40}
#__edit-fmt button svg{width:16px;height:16px;display:block}
#__edit-fmt button.txt{width:auto;min-width:34px;padding:0 8px;font:800 12px 'Manrope';letter-spacing:.02em}
#__edit-fmt .sep{width:1px;height:18px;background:var(--eui-line2);margin:0 5px;flex:none}
#__edit-fmt select{border:0;border-radius:9px;height:32px;padding:0 6px;font:800 12px 'Manrope';background:transparent;
color:var(--eui-txt);cursor:pointer;transition:background .15s;-webkit-appearance:none;appearance:none;text-align:center}
#__edit-fmt select:hover{background:var(--eui-hi2)}
#__edit-fmt select option{color:#101f4d;background:#fff;font-weight:700}
.__eui-clr{position:relative;width:34px;height:32px;border-radius:9px;display:grid;place-items:center;cursor:pointer;transition:background .15s}
.__eui-clr:hover{background:var(--eui-hi2)}
#__edit-swatch{width:15px;height:15px;border-radius:50%;background:#101f4d;border:2px solid #ffffffd9;box-shadow:0 1px 3px rgba(0,0,0,.5)}
.__eui-clr input{position:absolute;inset:0;opacity:0;cursor:pointer;border:0;padding:0}
/* ---------- tooltips ---------- */
[data-tip]{position:relative}
[data-tip]::after{content:attr(data-tip);position:absolute;left:50%;top:calc(100% + 8px);transform:translateX(-50%) translateY(-3px);
background:#050b20;color:#dce6ff;font:700 10.5px/1 'Manrope';padding:6px 9px;border-radius:7px;white-space:nowrap;
border:1px solid var(--eui-line);box-shadow:0 6px 18px rgba(2,8,30,.5);opacity:0;pointer-events:none;transition:.16s;z-index:10001}
[data-tip]:hover::after{opacity:1;transform:translateX(-50%) translateY(0)}
#__edit-ui [data-tip]::after,.__edit-handle [data-tip]::after{top:auto;bottom:calc(100% + 8px);transform:translateX(-50%) translateY(3px)}
#__edit-ui [data-tip]:hover::after,.__edit-handle [data-tip]:hover::after{transform:translateX(-50%) translateY(0)}
/* ---------- bottom action bar ---------- */
#__edit-ui{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;align-items:center;gap:4px;
background:var(--eui-bg);border:1px solid var(--eui-line);border-radius:100px;padding:7px;box-shadow:var(--eui-shadow);
animation:__eui-up .4s cubic-bezier(.22,.8,.35,1)}
#__edit-ui .st{display:flex;align-items:center;gap:8px;color:var(--eui-dim);font-size:12.5px;font-weight:700;
white-space:nowrap;padding:0 12px 0 10px;max-width:300px;overflow:hidden;text-overflow:ellipsis}
#__edit-ui .st::before{content:"";flex:none;width:7px;height:7px;border-radius:50%;background:currentColor;box-shadow:0 0 8px currentColor}
#__edit-ui .st.dirty{color:#ffb03a}#__edit-ui .st.ok{color:#3ddc97}#__edit-ui .st.err{color:#ff6b6b}
#__edit-ui button,#__edit-ui a{display:inline-flex;align-items:center;gap:7px;border:0;border-radius:100px;height:36px;
padding:0 15px;font:800 12.5px 'Manrope';cursor:pointer;color:var(--eui-txt);background:transparent;text-decoration:none;
white-space:nowrap;transition:background .15s,transform .06s}
#__edit-ui button svg,#__edit-ui a svg{width:14.5px;height:14.5px;flex:none}
#__edit-ui button:hover,#__edit-ui a:hover{background:var(--eui-hi2)}
#__edit-ui button:active{transform:scale(.96)}
#__edit-ui button.save{background:linear-gradient(92deg,var(--eui-blue),var(--eui-sky));color:#fff;
box-shadow:0 4px 16px #0094ff59,inset 0 1px 0 rgba(255,255,255,.28)}
#__edit-ui button.save:hover{filter:brightness(1.1)}
#__edit-ui button.danger{color:#ff9d96}
#__edit-ui button.danger:hover{background:#d92d2033;color:#ffb4ae}
#__edit-ui .vsep{width:1px;height:20px;background:var(--eui-line2);margin:0 3px;flex:none}
/* ---------- section handles ---------- */
body.__editing{padding-top:62px}
body.__editing main>section{position:relative}
.__edit-handle{position:absolute;top:12px;right:14px;display:flex;gap:2px;align-items:center;z-index:60;
background:var(--eui-bg);border:1px solid var(--eui-line);border-radius:100px;padding:4px;
box-shadow:0 8px 24px rgba(2,8,30,.4);opacity:0;transform:translateY(-3px);transition:opacity .18s,transform .18s}
body.__editing main>section:hover .__edit-handle,.__edit-handle:focus-within{opacity:1;transform:none}
.__edit-handle .grab,.__edit-handle button{display:grid;place-items:center;width:28px;height:26px;border:0;border-radius:100px;
background:transparent;color:var(--eui-dim);cursor:pointer;transition:background .15s,color .15s}
.__edit-handle .grab svg,.__edit-handle button svg{width:14px;height:14px}
.__edit-handle .grab{cursor:grab}.__edit-handle .grab:active{cursor:grabbing}
.__edit-handle .grab:hover,.__edit-handle button:hover{background:var(--eui-hi2);color:#fff}
.__edit-handle button.del:hover{background:#d92d20;color:#fff}
section.__drop-above{box-shadow:0 -3px 0 0 var(--eui-sky),0 -12px 28px -8px #4cc2ff66}
section.__drop-below{box-shadow:0 3px 0 0 var(--eui-sky),0 12px 28px -8px #4cc2ff66}
/* ---------- editable affordances ---------- */
[contenteditable]:hover{outline:1px dashed #4cc2ff40;outline-offset:6px;border-radius:4px}
[contenteditable]:focus{outline:2px solid #0094ff59;outline-offset:6px;border-radius:4px}
/* ---------- history panel ---------- */
#__edit-hist{position:fixed;right:18px;bottom:80px;z-index:9999;width:372px;max-width:92vw;max-height:64vh;overflow:auto;
background:var(--eui-bg);border:1px solid var(--eui-line);border-radius:18px;color:var(--eui-txt);
box-shadow:var(--eui-shadow);animation:__eui-pop .28s cubic-bezier(.22,.8,.35,1);scrollbar-width:thin}
#__edit-hist .hh{display:flex;justify-content:space-between;align-items:center;font:800 13.5px 'Manrope';color:#fff;
padding:15px 18px 13px;border-bottom:1px solid var(--eui-line2);position:sticky;top:0;background:inherit;backdrop-filter:inherit}
#__edit-hist .hh button{display:grid;place-items:center;width:26px;height:26px;border:0;border-radius:8px;
background:transparent;color:var(--eui-dim);cursor:pointer;transition:.15s}
#__edit-hist .hh button:hover{background:var(--eui-hi2);color:#fff}
#__edit-hist .hh button svg{width:13px;height:13px}
#__edit-hist .hb{padding:14px 18px;color:var(--eui-dim);font-size:12px;line-height:1.6}
#__edit-hist .hrow{display:flex;align-items:center;gap:10px;padding:12px 18px;border-bottom:1px solid var(--eui-line2);
font-size:12.5px;transition:background .15s;position:relative}
#__edit-hist .hrow:hover{background:var(--eui-hi)}
#__edit-hist .hrow::before{content:"";flex:none;width:8px;height:8px;border-radius:50%;
background:var(--eui-dim);box-shadow:0 0 0 3px rgba(143,160,201,.15)}
#__edit-hist .hrow.latest::before{background:var(--eui-sky);box-shadow:0 0 0 3px #4cc2ff2e,0 0 10px #4cc2ff88}
#__edit-hist .hrow.orig::before{background:#3ddc97;box-shadow:0 0 0 3px #3ddc972e}
#__edit-hist .hrow>div{flex:1;min-width:0}
#__edit-hist .hrow b{display:block;font-size:12.5px;color:#fff;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#__edit-hist .hrow span{color:var(--eui-dim);font-size:11px;font-weight:700}
#__edit-hist .hrow button{border:0;border-radius:100px;height:28px;padding:0 12px;font:800 11.5px 'Manrope';cursor:pointer;
color:var(--eui-txt);background:var(--eui-hi);white-space:nowrap;transition:background .15s,transform .06s}
#__edit-hist .hrow button:hover{background:var(--eui-hi2)}
#__edit-hist .hrow button:active{transform:scale(.95)}
#__edit-hist .hrow button[data-restore]{background:linear-gradient(92deg,var(--eui-blue),var(--eui-sky));color:#fff}
#__edit-hist .hrow button[data-restore]:hover{filter:brightness(1.12)}
@media(max-width:760px){#__edit-ui{flex-wrap:wrap;justify-content:center;border-radius:20px;max-width:94vw}
#__edit-ui .st{width:100%;justify-content:center;padding:4px 0}
#__edit-fmt{border-radius:14px}[data-tip]::after{display:none}}
</style>
<div id="__edit-fmt" class="__edit-x">
<button type="button" data-cmd="undo" data-tip="Undo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11"/></svg></button>
<button type="button" data-cmd="redo" data-tip="Redo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5 5.5 5.5 0 0 0 9.5 20H13"/></svg></button>
<span class="sep"></span>
<button type="button" data-cmd="bold" data-tip="Bold (Ctrl+B)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/></svg></button>
<button type="button" data-cmd="italic" data-tip="Italic (Ctrl+I)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/></svg></button>
<button type="button" data-cmd="underline" data-tip="Underline (Ctrl+U)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4v6a6 6 0 0 0 12 0V4"/><line x1="4" x2="20" y1="20" y2="20"/></svg></button>
<button type="button" data-cmd="strikeThrough" data-tip="Strikethrough"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" x2="20" y1="12" y2="12"/></svg></button>
<select id="__edit-size" data-tip="Font size">
<option value="">Size</option><option>12</option><option>14</option><option>16</option>
<option>18</option><option>22</option><option>28</option><option>36</option></select>
<label class="__eui-clr" data-tip="Text color"><span id="__edit-swatch"></span><input type="color" id="__edit-color" value="#101f4d"></label>
<span class="sep"></span>
<button type="button" class="txt" data-block="h2" data-tip="Heading 2">H2</button>
<button type="button" class="txt" data-block="h3" data-tip="Heading 3">H3</button>
<button type="button" class="txt" data-block="p" data-tip="Paragraph">&#182;</button>
<span class="sep"></span>
<button type="button" data-cmd="insertUnorderedList" data-tip="Bullet list"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path stroke-width="2.6" d="M3 6h.01"/><path stroke-width="2.6" d="M3 12h.01"/><path stroke-width="2.6" d="M3 18h.01"/></svg></button>
<button type="button" data-cmd="insertOrderedList" data-tip="Numbered list"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 6h11"/><path d="M10 12h11"/><path d="M10 18h11"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg></button>
<span class="sep"></span>
<button type="button" data-cmd="justifyLeft" data-tip="Align left"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="3" x2="21" y1="6" y2="6"/><line x1="3" x2="15" y1="12" y2="12"/><line x1="3" x2="17" y1="18" y2="18"/></svg></button>
<button type="button" data-cmd="justifyCenter" data-tip="Align center"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="3" x2="21" y1="6" y2="6"/><line x1="6" x2="18" y1="12" y2="12"/><line x1="4" x2="20" y1="18" y2="18"/></svg></button>
<button type="button" data-cmd="justifyRight" data-tip="Align right"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="3" x2="21" y1="6" y2="6"/><line x1="9" x2="21" y1="12" y2="12"/><line x1="7" x2="21" y1="18" y2="18"/></svg></button>
<span class="sep"></span>
<button type="button" id="__edit-link" data-tip="Insert link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></button>
<button type="button" data-cmd="unlink" data-tip="Remove link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m18.84 12.25 1.72-1.71a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71"/><path d="m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71"/><line x1="8" x2="8" y1="2" y2="5"/><line x1="2" x2="5" y1="8" y2="8"/><line x1="16" x2="16" y1="19" y2="22"/><line x1="19" x2="22" y1="16" y2="16"/></svg></button>
<button type="button" id="__edit-img" data-tip="Upload image"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10"/><path d="m14 19 3-3 3 3"/><path d="M17 22v-5.5"/><circle cx="9" cy="9" r="2"/><path d="m3 16 3.1-3.1a2 2 0 0 1 2.81.01L12 16"/></svg></button>
<button type="button" id="__edit-imgurl" data-tip="Image from URL"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg></button>
<button type="button" id="__edit-table" data-tip="Insert table"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/><path d="M3 9h18"/><path d="M3 15h18"/></svg></button>
<span class="sep"></span>
<button type="button" data-cmd="removeFormat" data-tip="Clear formatting"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg></button>
</div>
<div id="__edit-ui" class="__edit-x">
<span class="st" id="__edit-state">Edit mode</span>
<span class="vsep"></span>
<button type="button" id="__edit-add" data-tip="Insert a new section"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>Section</button>
<button type="button" id="__edit-history" data-tip="Versions &amp; restore"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>History</button>
<a id="__edit-view" href="#" data-tip="Open the live report"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/></svg>View</a>
<button type="button" class="danger" id="__edit-reset" data-tip="Restore the original AI report"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>Reset</button>
<button type="button" class="save" id="__edit-save"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Save</button>
</div>
<div id="__edit-hist" class="__edit-x" hidden></div>
<input type="file" id="__edit-file" class="__edit-x" accept="image/*" style="display:none">
<script id="__edit-js" class="__edit-x">
(function(){
  document.getElementById('__edit-view').href = location.pathname.replace(/\\/edit$/, '');
  document.body.classList.add('__editing');
  ['.hero-in','.strip','main','footer'].forEach(function(sel){
    document.querySelectorAll(sel).forEach(function(el){ el.setAttribute('contenteditable','true'); });
  });
  try { document.execCommand('styleWithCSS', false, true); } catch(e){}

  var state = document.getElementById('__edit-state'), dirty = false;
  function setState(msg, cls){ state.textContent = msg; state.className = 'st' + (cls ? ' ' + cls : ''); }
  function markDirty(){ dirty = true; setState('Unsaved changes', 'dirty'); }
  document.addEventListener('input', markDirty);
  window.addEventListener('beforeunload', function(e){ if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  // ---- formatting toolbar (mousedown-preventDefault keeps the text selection) ----
  var fmt = document.getElementById('__edit-fmt');
  fmt.addEventListener('mousedown', function(e){ if (e.target.closest('button')) e.preventDefault(); });
  fmt.addEventListener('click', function(e){
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.cmd) { document.execCommand(b.dataset.cmd, false, null); markDirty(); }
    else if (b.dataset.block) { document.execCommand('formatBlock', false, b.dataset.block); markDirty(); }
  });
  // Highlight buttons matching the formatting at the caret.
  var stateCmds = ['bold','italic','underline','strikeThrough','insertUnorderedList','insertOrderedList',
    'justifyLeft','justifyCenter','justifyRight'];
  document.addEventListener('selectionchange', function(){
    stateCmds.forEach(function(c){
      var b = fmt.querySelector('[data-cmd="' + c + '"]'); if (!b) return;
      var on = false; try { on = document.queryCommandState(c); } catch(e){}
      b.classList.toggle('on', on);
    });
  });
  document.getElementById('__edit-size').addEventListener('change', function(){
    var px = this.value; this.value = ''; if (!px) return;
    try { document.execCommand('styleWithCSS', false, false); } catch(e){}
    document.execCommand('fontSize', false, '7');
    try { document.execCommand('styleWithCSS', false, true); } catch(e){}
    document.querySelectorAll('font[size="7"]').forEach(function(f){
      var s = document.createElement('span'); s.style.fontSize = px + 'px';
      while (f.firstChild) s.appendChild(f.firstChild);
      f.replaceWith(s);
    });
    markDirty();
  });
  document.getElementById('__edit-color').addEventListener('input', function(){
    document.getElementById('__edit-swatch').style.background = this.value;
    document.execCommand('foreColor', false, this.value); markDirty();
  });
  document.getElementById('__edit-link').onclick = function(){
    var href = prompt('Link URL:', 'https://'); if (!href) return;
    document.execCommand('createLink', false, href); markDirty();
  };

  // ---- insert helpers: place after the block the caret is in, else end of first section ----
  function insertBlock(el){
    var sel = getSelection();
    if (sel.rangeCount) {
      var node = sel.anchorNode;
      var cur = node && (node.nodeType === 1 ? node : node.parentElement);
      var sec = cur && cur.closest && cur.closest('main section');
      if (sec) {
        if (cur === sec) sec.appendChild(el);
        else {
          while (cur.parentElement !== sec) cur = cur.parentElement;
          sec.insertBefore(el, cur.nextSibling);
        }
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        markDirty(); return;
      }
    }
    var first = document.querySelector('main section');
    if (first) { first.appendChild(el); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); markDirty(); }
  }

  // ---- insert table (matches the report's .tablewrap styling) ----
  document.getElementById('__edit-table').onclick = function(){
    var cols = parseInt(prompt('Number of columns:', '3'), 10);
    var rows = parseInt(prompt('Number of rows (excluding header):', '3'), 10);
    if (!(cols > 0) || !(rows > 0) || cols > 12 || rows > 50) return;
    var wrap = document.createElement('div'); wrap.className = 'tablewrap';
    var tbl = document.createElement('table');
    var thead = document.createElement('thead'), htr = document.createElement('tr');
    for (var c = 0; c < cols; c++) { var th = document.createElement('th'); th.textContent = 'Header ' + (c + 1); htr.appendChild(th); }
    thead.appendChild(htr); tbl.appendChild(thead);
    var tbody = document.createElement('tbody');
    for (var r = 0; r < rows; r++) {
      var tr = document.createElement('tr');
      for (var c2 = 0; c2 < cols; c2++) { var td = document.createElement('td'); td.textContent = '\\u2014'; tr.appendChild(td); }
      tbody.appendChild(tr);
    }
    tbl.appendChild(tbody); wrap.appendChild(tbl);
    insertBlock(wrap);
  };

  // ---- insert image: file upload compressed to an embedded data URL, or URL ----
  var fileInput = document.getElementById('__edit-file');
  document.getElementById('__edit-img').onclick = function(){ fileInput.value = ''; fileInput.click(); };
  document.getElementById('__edit-imgurl').onclick = function(){
    var u = prompt('Image URL:', 'https://');
    if (u && u.trim() && u.trim() !== 'https://') placeImage(u.trim());
  };
  fileInput.addEventListener('change', function(){
    var f = this.files && this.files[0]; if (!f) return;
    var img = new Image();
    img.onload = function(){
      var MAX = 1400, w = img.width, h = img.height;
      if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
      var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(img.src);
      placeImage(f.type === 'image/png' && f.size < 400000
        ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = function(){ alert('Could not read that image file.'); };
    img.src = URL.createObjectURL(f);
  });
  function placeImage(src){
    var im = document.createElement('img');
    im.src = src; im.alt = '';
    im.style.cssText = 'max-width:100%;height:auto;border-radius:12px;display:block;margin:16px auto';
    insertBlock(im);
  }

  // ---- section handles: drag to reorder, move up/down, delete ----
  function renumber(){
    var i = 0;
    document.querySelectorAll('main>section .eyebrow .n').forEach(function(n){
      n.textContent = String(++i).padStart(2, '0');
    });
    var nav = document.querySelector('nav');
    if (nav) document.querySelectorAll('main>section').forEach(function(sec){
      var a = nav.querySelector('a[href="#' + sec.id + '"]'); if (a) nav.appendChild(a);
    });
  }
  var dragSec = null;
  function clearDrop(){ document.querySelectorAll('.__drop-above,.__drop-below').forEach(function(s){
    s.classList.remove('__drop-above', '__drop-below'); }); }
  var ICONS = {
    grip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>',
    dn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'
  };
  function addHandles(){
    document.querySelectorAll('main>section').forEach(function(sec){
      if (sec.querySelector('.__edit-handle')) return;
      var h = document.createElement('div');
      h.className = '__edit-handle __edit-x'; h.contentEditable = 'false';
      h.innerHTML = '<span class="grab" draggable="true" data-tip="Drag to move">' + ICONS.grip + '</span>' +
        '<button type="button" class="up" data-tip="Move up">' + ICONS.up + '</button>' +
        '<button type="button" class="dn" data-tip="Move down">' + ICONS.dn + '</button>' +
        '<button type="button" class="del" data-tip="Delete section">' + ICONS.x + '</button>';
      sec.insertBefore(h, sec.firstChild);
      h.querySelector('.up').onclick = function(){
        var prev = sec.previousElementSibling;
        if (prev) { sec.parentElement.insertBefore(sec, prev); renumber(); markDirty();
          sec.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      };
      h.querySelector('.dn').onclick = function(){
        var next = sec.nextElementSibling;
        if (next) { sec.parentElement.insertBefore(next, sec); renumber(); markDirty();
          sec.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      };
      h.querySelector('.del').onclick = function(){
        if (!confirm('Delete this entire section?')) return;
        var nav = document.querySelector('nav');
        var a = nav && nav.querySelector('a[href="#' + sec.id + '"]'); if (a) a.remove();
        sec.remove(); renumber(); markDirty();
      };
      h.querySelector('.grab').addEventListener('dragstart', function(e){
        dragSec = sec; e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', sec.id); } catch(err){}
        e.dataTransfer.setDragImage(sec, 20, 20);
      });
      h.querySelector('.grab').addEventListener('dragend', function(){ dragSec = null; clearDrop(); });
    });
  }
  var main = document.querySelector('main');
  if (main) {
    main.addEventListener('dragover', function(e){
      if (!dragSec) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      clearDrop();
      var over = e.target.closest && e.target.closest('main>section');
      if (!over || over === dragSec) return;
      var r = over.getBoundingClientRect();
      over.classList.add(e.clientY < r.top + r.height / 2 ? '__drop-above' : '__drop-below');
    });
    main.addEventListener('drop', function(e){
      if (!dragSec) return;
      e.preventDefault();
      var over = e.target.closest && e.target.closest('main>section');
      if (over && over !== dragSec) {
        var r = over.getBoundingClientRect();
        main.insertBefore(dragSec, e.clientY < r.top + r.height / 2 ? over : over.nextElementSibling);
        renumber(); markDirty();
      }
      dragSec = null; clearDrop();
    });
  }
  addHandles();

  // ---- add section ----
  document.getElementById('__edit-add').onclick = function(){
    var title = prompt('New section title:'); if (!title) return;
    if (!main) return alert('No <main> found');
    var id = 'custom-' + Date.now().toString(36);
    var sec = document.createElement('section');
    sec.id = id; sec.className = 'reveal in';
    var eyebrow = document.createElement('div'); eyebrow.className = 'eyebrow';
    var num = document.createElement('span'); num.className = 'n'; num.textContent = '00';
    eyebrow.appendChild(num); eyebrow.appendChild(document.createTextNode(title));
    var h2 = document.createElement('h2'); h2.textContent = title;
    var p = document.createElement('p'); p.className = 'lead';
    p.textContent = 'Write your content here\\u2026';
    sec.appendChild(eyebrow); sec.appendChild(h2); sec.appendChild(p);
    var cta = document.getElementById('cta');
    cta && cta.parentNode === main ? main.insertBefore(sec, cta) : main.appendChild(sec);
    var nav = document.querySelector('nav');
    if (nav) { var a = document.createElement('a'); a.href = '#' + id; a.textContent = title; nav.appendChild(a); }
    addHandles(); renumber();
    sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    markDirty();
  };

  // ---- version history: list, preview, restore ----
  var hist = document.getElementById('__edit-hist');
  function histRow(id, label, meta, cls){
    return '<div class="hrow' + (cls ? ' ' + cls : '') + '"><div><b>' + label + '</b>' +
      (meta ? '<span>' + meta + '</span>' : '') + '</div>' +
      '<button type="button" data-view="' + id + '">Preview</button>' +
      '<button type="button" data-restore="' + id + '">Restore</button></div>';
  }
  document.getElementById('__edit-history').onclick = function(){
    if (!hist.hidden) { hist.hidden = true; return; }
    hist.hidden = false;
    hist.innerHTML = '<div class="hh">Version history</div><div class="hb">Loading\\u2026</div>';
    fetch(location.pathname + '/versions')
      .then(function(r){ return r.json(); })
      .then(function(d){
        var rows = (d.versions || []).map(function(v, i){
          return histRow(v.id, new Date(Number(v.id)).toLocaleString(),
            Math.max(1, Math.round(v.size / 1024)) + ' KB' + (i === 0 ? ' \\u00b7 most recent' : ''),
            i === 0 ? 'latest' : '');
        }).join('');
        if (d.hasOrig) rows += histRow('orig', 'Original AI-generated report', 'starting point', 'orig');
        hist.innerHTML = '<div class="hh">Version history <button type="button" id="__edit-hclose">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>' +
          (rows || '<div class="hb">No versions yet \\u2014 a version is snapshotted every time you save or restore.</div>') +
          '<div class="hb">Each entry is the report as it was before that save. Preview opens in a new tab; Restore makes it the live report \\u2014 the current version is kept in history, so nothing is lost.</div>';
        document.getElementById('__edit-hclose').onclick = function(){ hist.hidden = true; };
      })
      .catch(function(){ hist.innerHTML = '<div class="hb">Could not load history.</div>'; });
  };
  hist.addEventListener('click', function(e){
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.view) window.open(location.pathname + '/version?id=' + b.dataset.view, '_blank');
    else if (b.dataset.restore) {
      if (!confirm('Make this version the live report? The current version will be kept in history.')) return;
      fetch(location.pathname + '/restore', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: b.dataset.restore }) })
        .then(function(r){ return r.json().then(function(x){ return r.ok ? x : Promise.reject(x.error || r.status); }); })
        .then(function(){ dirty = false; location.reload(); })
        .catch(function(err){ setState('Restore failed: ' + err, 'err'); });
    }
  });

  // ---- save / reset ----
  document.getElementById('__edit-save').onclick = function(){
    setState('Saving\\u2026');
    var doc = document.documentElement.cloneNode(true);
    doc.querySelectorAll('.__edit-x').forEach(function(el){ el.remove(); });
    doc.querySelectorAll('[contenteditable]').forEach(function(el){ el.removeAttribute('contenteditable'); });
    doc.querySelectorAll('[draggable]').forEach(function(el){ el.removeAttribute('draggable'); });
    doc.querySelectorAll('.__drop-above,.__drop-below').forEach(function(el){
      el.classList.remove('__drop-above', '__drop-below'); });
    var body = doc.querySelector('body'); if (body) body.classList.remove('__editing');
    fetch(location.pathname, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: '<!DOCTYPE html>' + doc.outerHTML }) })
      .then(function(r){ return r.json().then(function(b){ return r.ok ? b : Promise.reject(b.error || r.status); }); })
      .then(function(){ dirty = false; setState('Saved \\u2713', 'ok'); })
      .catch(function(e){ setState('Save failed: ' + e, 'err'); });
  };
  document.getElementById('__edit-reset').onclick = function(){
    if (!confirm('Discard ALL edits and restore the original AI-generated report?')) return;
    fetch(location.pathname + '/reset', { method: 'POST' })
      .then(function(r){ return r.json().then(function(b){ return r.ok ? b : Promise.reject(b.error || r.status); }); })
      .then(function(){ dirty = false; location.reload(); })
      .catch(function(e){ setState('Reset failed: ' + e, 'err'); });
  };
})();
</script>`;
