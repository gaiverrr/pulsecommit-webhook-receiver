const MAX_BYTES = 1024 * 1024;
const EVENT_TYPES = new Set(["daily_export", "test"]);
const encoder = new TextEncoder();

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

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
    if (request.method !== "POST" || url.pathname !== "/") {
      return json(405, { ok: false, error: "method_not_allowed" }, { Allow: "POST" });
    }
    if (!(await tokenMatches(request.headers.get("Authorization"), env.WEBHOOK_TOKEN))) {
      return json(401, { ok: false, error: "unauthorized" }, { "WWW-Authenticate": "Bearer" });
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
    return json(200, { ok: true, event_type: payload.event_type, bytes: bytes.byteLength });
}
