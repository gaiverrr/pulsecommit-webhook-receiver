import { clearEvents, latestEvents, storeEvent } from "./inbox.js";
import { VIEWER_CSS, VIEWER_HTML, VIEWER_JS } from "./viewer.js";

const MAX_BYTES = 1024 * 1024;
const EVENT_TYPES = new Set(["daily_export", "test"]);
const encoder = new TextEncoder();
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const ASSETS = {
  "/": [VIEWER_HTML, "text/html; charset=utf-8"],
  "/viewer.js": [VIEWER_JS, "text/javascript; charset=utf-8"],
  "/viewer.css": [VIEWER_CSS, "text/css; charset=utf-8"],
};

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

function asset(path) {
  const [body, type] = ASSETS[path];
  return new Response(body, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "no-store",
      "Content-Security-Policy": CSP,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

const notFound = () => json(404, { ok: false, error: "not_found" });
const unauthorized = () => json(401, { ok: false, error: "unauthorized" }, { "WWW-Authenticate": "Bearer" });

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function tokenMatches(header, secret) {
  if (typeof secret !== "string" || secret.length === 0) return false;
  const match = /^Bearer (.+)$/.exec(header ?? "");
  const [given, expected] = await Promise.all([digest(match ? match[1] : ""), digest(secret)]);
  let diff = match ? 0 : 1;
  for (let i = 0; i < expected.length; i++) diff |= given[i] ^ expected[i];
  return diff === 0;
}

async function readLimited(request) {
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch {
      return json(500, { ok: false, error: "internal" });
    }
  },
};

async function handle(request, env) {
  const url = new URL(request.url);
  const inbox = env.MODE === "inbox";
  if (inbox && !env.EVENTS) return json(500, { ok: false, error: "inbox_not_configured" });

  if (url.pathname === "/events") {
    if (!inbox) return notFound();
    if (request.method !== "GET" && request.method !== "DELETE") {
      return json(405, { ok: false, error: "method_not_allowed" }, { Allow: "GET, DELETE" });
    }
    if (!(await tokenMatches(request.headers.get("Authorization"), env.VIEW_TOKEN))) return unauthorized();
    if (request.method === "DELETE") return json(200, { ok: true, deleted: await clearEvents(env.EVENTS) });
    return json(200, { ok: true, events: await latestEvents(env.EVENTS) });
  }

  if (request.method === "GET" || request.method === "HEAD") {
    if (inbox && Object.hasOwn(ASSETS, url.pathname)) return asset(url.pathname);
    return notFound();
  }

  if (request.method !== "POST" || url.pathname !== "/") {
    return json(405, { ok: false, error: "method_not_allowed" }, { Allow: inbox ? "GET, POST" : "POST" });
  }
  return ingest(request, env, inbox);
}

async function ingest(request, env, inbox) {
  if (!(await tokenMatches(request.headers.get("Authorization"), env.WEBHOOK_TOKEN))) {
    return unauthorized();
  }
  const contentType = (request.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return json(415, { ok: false, error: "unsupported_media_type" });
  }
  const bytes = await readLimited(request);
  if (bytes === null) return json(413, { ok: false, error: "payload_too_large" });

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return json(400, { ok: false, error: "invalid_json" });
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return json(400, { ok: false, error: "invalid_body" });
  }
  if (!EVENT_TYPES.has(payload.event_type)) {
    return json(400, { ok: false, error: "invalid_event_type" });
  }
  if (payload.event_type === "daily_export") {
    const summaryOk = payload.summary !== null && typeof payload.summary === "object" && !Array.isArray(payload.summary);
    if (!summaryOk || typeof payload.date !== "string") {
      return json(400, { ok: false, error: "invalid_daily_export" });
    }
  }
  if (inbox) await storeEvent(env.EVENTS, request, payload, bytes.byteLength);
  return json(200, { ok: true, event_type: payload.event_type, bytes: bytes.byteLength });
}
