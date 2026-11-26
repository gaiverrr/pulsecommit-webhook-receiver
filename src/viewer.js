export const VIEWER_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Pulse Commit inbox</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="/viewer.css">
<script src="/viewer.js" defer></script>
</head>
<body>
<header>
  <p class="super">$ pulse inbox --tail 50</p>
  <h1>Webhook inbox</h1>
  <p class="status" id="status">Not connected</p>
</header>
<form id="login" hidden>
  <label for="token">View token</label>
  <div class="row">
    <input id="token" type="password" autocomplete="off" spellcheck="false" placeholder="VIEW_TOKEN">
    <button type="submit" class="primary">Connect</button>
  </div>
  <p class="hint">Kept in this tab's sessionStorage only.</p>
</form>
<section id="app" hidden>
  <div class="toolbar">
    <label class="toggle"><input id="auto" type="checkbox" checked> Auto-refresh 10 s</label>
    <button id="refresh" type="button">Refresh</button>
    <button id="clear" type="button" class="danger">Clear inbox</button>
    <button id="logout" type="button">Forget token</button>
  </div>
  <div class="panes">
    <div class="card list-card">
      <div class="section-header"><span>Events</span><span id="count" class="mono">0 / 50</span></div>
      <ul id="list"></ul>
      <p id="empty" class="empty" hidden>No events yet. Send a test from Pulse Commit.</p>
    </div>
    <div class="card detail-card">
      <div class="section-header"><span>Detail</span><span id="detail-id" class="mono id"></span></div>
      <p id="placeholder" class="empty">Select an event.</p>
      <div id="detail" hidden>
        <h2>summary_markdown</h2>
        <pre id="markdown"></pre>
        <h2>body</h2>
        <pre id="json"></pre>
      </div>
    </div>
  </div>
</section>
</body>
</html>
`;

export const VIEWER_CSS = `:root {
  --bg: #0a0a0a; --surface: #141414; --elevated: #1c1c1c; --raised: #242424;
  --hairline: rgba(255,255,255,0.10); --divider: rgba(255,255,255,0.07);
  --text: #fafafa; --muted: #a3a3a3; --dim: #737373; --faint: #525252;
  --accent: #A4F03A; --accent-soft: rgba(164,240,58,0.16); --error: #FF453A; --success: #00D26A;
  --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
  color-scheme: dark;
}
* { box-sizing: border-box; }
body { margin: 0; padding: 24px 16px 48px; background: var(--bg); color: var(--text);
  font: 15px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif; }
header, form, section { max-width: 1200px; margin: 0 auto; }
.super { margin: 0; font: 12px var(--mono); color: var(--dim); }
h1 { margin: 4px 0 2px; font-size: 24px; font-weight: 600; }
.status { margin: 0 0 20px; font: 12px var(--mono); color: var(--muted); }
.status.error { color: var(--error); }
.mono { font-family: var(--mono); }
.section-header .id { text-transform: none; letter-spacing: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-left: 12px; }
label { display: block; font: 10px var(--mono); letter-spacing: 1.5px; text-transform: uppercase; color: var(--dim); margin-bottom: 8px; }
.row { display: flex; gap: 8px; }
input[type=password] { flex: 1; min-width: 0; background: var(--elevated); border: 1px solid var(--hairline); border-radius: 10px;
  color: var(--text); padding: 10px 12px; font: 14px var(--mono); }
input[type=password]:focus { outline: 1px solid var(--accent); }
.hint { font-size: 12px; color: var(--dim); }
button { background: var(--elevated); color: var(--text); border: 1px solid var(--hairline); border-radius: 10px;
  padding: 8px 14px; font: inherit; font-size: 14px; cursor: pointer; }
button:hover { background: var(--raised); }
button.primary { background: var(--accent); color: #000; border-color: var(--accent); font-weight: 600; }
button.danger { color: var(--error); }
.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 16px; }
.toggle { display: flex; align-items: center; gap: 8px; margin: 0 8px 0 0; font-size: 12px; letter-spacing: 0; text-transform: none; color: var(--muted); }
.toggle input { accent-color: var(--accent); }
.panes { display: grid; align-items: start; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: 16px; }
@media (max-width: 800px) { .panes { grid-template-columns: minmax(0, 1fr); } }
.card { background: var(--surface); border: 1px solid var(--hairline); border-radius: 16px; padding: 14px; min-width: 0; }
.section-header { display: flex; justify-content: space-between; font: 10px var(--mono); letter-spacing: 1.5px;
  text-transform: uppercase; color: var(--dim); margin-bottom: 10px; }
ul { list-style: none; margin: 0; padding: 0; }
li button { width: 100%; text-align: left; display: grid; grid-template-columns: auto 1fr auto; gap: 4px 10px;
  background: transparent; border: 1px solid transparent; border-radius: 10px; padding: 10px; }
li + li { border-top: 1px solid var(--divider); }
li button:hover { background: var(--elevated); }
li button[aria-current=true] { background: var(--accent-soft); border-color: rgba(164,240,58,0.35); }
.time { font: 13px var(--mono); color: var(--text); }
.pill { font: 11px var(--mono); padding: 1px 8px; border-radius: 999px; background: var(--elevated); color: var(--muted); justify-self: start; }
.pill.daily_export { background: var(--accent-soft); color: var(--accent); }
.bytes { font: 12px var(--mono); color: var(--dim); text-align: right; }
.meta { grid-column: 1 / -1; font: 12px var(--mono); color: var(--dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.empty { color: var(--dim); font-size: 13px; }
h2 { font: 10px var(--mono); letter-spacing: 1.5px; text-transform: uppercase; color: var(--dim); margin: 6px 0 8px; font-weight: 400; }
pre { margin: 0 0 16px; background: #000; border: 1px solid var(--hairline); border-radius: 10px; padding: 12px;
  font: 12px/1.5 var(--mono); color: var(--text); white-space: pre-wrap; word-break: break-word; max-height: 60vh; overflow: auto; }
`;

export const VIEWER_JS = `(() => {
  const KEY = "pulsecommit.inbox.viewToken";
  const $ = (id) => document.getElementById(id);
  let events = [];
  let selected = null;
  let timer = null;

  const store = {
    get() { try { return sessionStorage.getItem(KEY); } catch { return null; } },
    set(v) { try { sessionStorage.setItem(KEY, v); } catch {} },
    clear() { try { sessionStorage.removeItem(KEY); } catch {} },
  };
  let token = store.get();

  function status(text, error = false) {
    $("status").textContent = text;
    $("status").classList.toggle("error", error);
  }

  function showLogin(message) {
    token = null;
    store.clear();
    stop();
    $("app").hidden = true;
    $("login").hidden = false;
    status(message ?? "Not connected", Boolean(message));
    $("token").focus();
  }

  async function api(method) {
    const res = await fetch("/events", { method, headers: { Authorization: "Bearer " + token }, cache: "no-store" });
    if (res.status === 401) { showLogin("View token rejected (401)"); return null; }
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function fmtTime(iso) {
    const d = new Date(iso);
    return isNaN(d) ? String(iso) : d.toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  }

  function fmtBytes(n) {
    return typeof n === "number" ? n.toLocaleString("en-US").replace(/,/g, " ") + " B" : "";
  }

  function renderList() {
    const list = $("list");
    list.replaceChildren();
    $("count").textContent = events.length + " / 50";
    $("empty").hidden = events.length > 0;
    for (const e of events) {
      const li = el("li");
      const b = el("button");
      b.type = "button";
      b.setAttribute("aria-current", String(e.id === selected));
      b.append(
        el("span", "time", fmtTime(e.received_at)),
        el("span", "pill " + (e.event_type === "daily_export" ? "daily_export" : ""), String(e.event_type)),
        el("span", "bytes", fmtBytes(e.bytes)),
        el("span", "meta", [e.date ? "date " + e.date : null, e.idempotency_key ?? "no idempotency key"].filter(Boolean).join("  ·  ")),
      );
      b.addEventListener("click", () => { selected = e.id; renderList(); renderDetail(); });
      li.append(b);
      list.append(li);
    }
  }

  function renderDetail() {
    const e = events.find((x) => x.id === selected);
    $("placeholder").hidden = Boolean(e);
    $("detail").hidden = !e;
    $("detail-id").textContent = e ? (e.idempotency_key ?? "") : "";
    if (!e) return;
    const md = e.body && typeof e.body.summary_markdown === "string" ? e.body.summary_markdown : "(no summary_markdown)";
    $("markdown").textContent = md;
    $("json").textContent = JSON.stringify(e.body, null, 2);
  }

  async function load() {
    if (!token) return;
    try {
      const data = await api("GET");
      if (!data) return;
      events = Array.isArray(data.events) ? data.events : [];
      renderList();
      renderDetail();
      status("Updated " + new Date().toLocaleTimeString(undefined, { hour12: false }) + "  ·  " + events.length + " events");
    } catch (err) {
      status("Refresh failed: " + err.message, true);
    }
  }

  function stop() { if (timer) { clearInterval(timer); timer = null; } }
  function schedule() {
    stop();
    if (token && $("auto").checked && !document.hidden) timer = setInterval(load, 10000);
  }

  function connect() {
    $("login").hidden = true;
    $("app").hidden = false;
    load();
    schedule();
  }

  $("login").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const v = $("token").value.trim();
    if (!v) return;
    token = v;
    store.set(v);
    $("token").value = "";
    connect();
  });
  $("auto").addEventListener("change", schedule);
  $("refresh").addEventListener("click", load);
  $("logout").addEventListener("click", () => showLogin());
  $("clear").addEventListener("click", async () => {
    if (!confirm("Delete every stored event?")) return;
    try {
      const data = await api("DELETE");
      if (!data) return;
      selected = null;
      await load();
    } catch (err) {
      status("Clear failed: " + err.message, true);
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && token && $("auto").checked) load();
    schedule();
  });

  if (token) connect(); else showLogin();
})();
`;
