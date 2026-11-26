import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";
import { FakeKV } from "./fake-kv.js";

const TOKEN = "webhook-token-abc";
const VIEW = "view-token-xyz";

let kv;
let env;
let spies;
let clock;

beforeEach(() => {
  kv = new FakeKV();
  env = { MODE: "inbox", WEBHOOK_TOKEN: TOKEN, VIEW_TOKEN: VIEW, EVENTS: kv };
  spies = ["log", "info", "warn", "error", "debug"].map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
  clock = Date.parse("2026-11-26T10:00:00.000Z");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function tick(ms = 1000) {
  clock += ms;
  vi.setSystemTime(clock);
}

function call(path, { method = "GET", token, body, headers = {}, environment = env } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  const init = { method, headers: h };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    h["Content-Type"] ??= "application/json";
  }
  return worker.fetch(new Request(`https://example.com${path}`, init), environment);
}

function ingest(body, headers = {}, environment = env) {
  return call("/", { method: "POST", token: TOKEN, body, headers, environment });
}

const daily = (n = 0) => ({
  schema_version: "1.0",
  event_type: "daily_export",
  date: "2026-11-25",
  idempotency_key: `pc-2026-11-25-${String(n).padStart(12, "0")}`,
  summary: { steps: 1000 + n },
  summary_markdown: `# Day ${n}`,
  files: [{ path: "summary.json", bytes: 20 }],
});

describe("inbox mode", () => {
  it("stores an accepted request with metadata and a 7 day TTL", async () => {
    const body = JSON.stringify(daily(1));
    const res = await ingest(body, { "Idempotency-Key": "pc-2026-11-25-000000000001", "User-Agent": "PulseCommit/1.0.2" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, event_type: "daily_export", bytes: new TextEncoder().encode(body).length });

    expect(kv.puts).toHaveLength(1);
    const { key, value, options } = kv.puts[0];
    expect(key).toBe("evt:2026-11-26T10:00:00.000Z:pc-2026-11-25-000000000001");
    expect(options.expirationTtl).toBe(7 * 24 * 60 * 60);
    expect(JSON.parse(value)).toEqual({
      received_at: "2026-11-26T10:00:00.000Z",
      event_type: "daily_export",
      date: "2026-11-25",
      idempotency_key: "pc-2026-11-25-000000000001",
      user_agent: "PulseCommit/1.0.2",
      bytes: new TextEncoder().encode(body).length,
      body: daily(1),
    });
  });

  it("uses the Idempotency-Key header, then the body field, then a random id", async () => {
    await ingest({ event_type: "test" }, { "Idempotency-Key": "pc-test-abc123" });
    tick();
    await ingest(daily(7));
    tick();
    await ingest({ event_type: "test" });
    tick();
    await ingest({ event_type: "test" }, { "Idempotency-Key": "bad key/with:chars" });
    tick();
    await ingest({ event_type: "test" }, { "Idempotency-Key": "a".repeat(200) });
    const keys = kv.puts.map((p) => p.key);
    expect(keys[0]).toMatch(/:pc-test-abc123$/);
    expect(keys[1]).toMatch(/:pc-2026-11-25-000000000007$/);
    for (const k of keys.slice(2)) expect(k).toMatch(/^evt:[0-9TZ:.-]+:[0-9a-f-]{36}$/);
    expect(JSON.parse(kv.puts[0].value).idempotency_key).toBe("pc-test-abc123");
    expect(JSON.parse(kv.puts[2].value).idempotency_key).toBeNull();
  });

  it("keeps only the latest 50 events", async () => {
    for (let i = 0; i < 55; i++) {
      expect((await ingest(daily(i))).status).toBe(200);
      tick();
    }
    const keys = [...kv.store.keys()].filter((k) => k.startsWith("evt:")).sort();
    expect(keys).toHaveLength(50);
    expect(JSON.parse(kv.store.get(keys[0])).body.summary.steps).toBe(1005);

    const res = await call("/events", { token: VIEW });
    expect(res.status).toBe(200);
    const { events } = await res.json();
    expect(events).toHaveLength(50);
    expect(events[0].body.summary.steps).toBe(1054);
    expect(events[49].body.summary.steps).toBe(1005);
    expect(events[0].id).toBe(keys[49]);
  });

  it("never stores the Authorization header or either token", async () => {
    await ingest(daily(1), { "User-Agent": "PulseCommit/1.0.2", "X-Extra": "x" });
    await ingest({ event_type: "test" }, { "Idempotency-Key": "pc-test-1" });
    expect(kv.puts.length).toBe(2);
    for (const { key, value } of kv.puts) {
      for (const s of [TOKEN, VIEW, "Bearer", "Authorization", "authorization"]) {
        expect(key).not.toContain(s);
        expect(value).not.toContain(s);
      }
    }
  });

  it("stores nothing for rejected requests", async () => {
    await call("/", { method: "POST", token: "wrong", body: daily(1) });
    await call("/", { method: "POST", token: VIEW, body: daily(1) });
    await ingest("{nope");
    await ingest({ event_type: "other" });
    await ingest(daily(1), { "Content-Type": "text/plain" });
    expect(kv.puts).toHaveLength(0);
  });

  it("still returns 200 when pruning fails after the write", async () => {
    kv.failOn.add("list");
    const res = await ingest(daily(1));
    expect(res.status).toBe(200);
    expect(kv.store.size).toBe(1);
    kv.failOn.clear();
    kv.failOn.add("delete");
    for (let i = 0; i < 51; i++) {
      tick();
      expect((await ingest(daily(i))).status).toBe(200);
    }
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  it("returns 500 without logging when the write fails", async () => {
    kv.failOn.add("put");
    const res = await ingest({ ...daily(1), summary_markdown: "SECRET-BODY-TEXT" });
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("SECRET-BODY-TEXT");
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  it("fails closed when the EVENTS binding is missing", async () => {
    const res = await ingest(daily(1), {}, { MODE: "inbox", WEBHOOK_TOKEN: TOKEN, VIEW_TOKEN: VIEW });
    expect(res.status).toBe(500);
  });

  it("requires the view token for GET /events", async () => {
    await ingest(daily(1));
    expect((await call("/events")).status).toBe(401);
    expect((await call("/events", { token: "wrong" })).status).toBe(401);
    expect((await call("/events", { token: TOKEN })).status).toBe(401);
    const ok = await call("/events", { token: VIEW });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Cache-Control")).toBe("no-store");
    expect((await ok.json()).events).toHaveLength(1);
  });

  it("rejects GET /events when VIEW_TOKEN is not set", async () => {
    const res = await call("/events", { token: VIEW, environment: { ...env, VIEW_TOKEN: undefined } });
    expect(res.status).toBe(401);
  });

  it("does not accept the view token for ingest", async () => {
    expect((await call("/", { method: "POST", token: VIEW, body: daily(1) })).status).toBe(401);
  });

  it("DELETE /events clears the inbox with the view token only", async () => {
    for (let i = 0; i < 3; i++) {
      await ingest(daily(i));
      tick();
    }
    expect((await call("/events", { method: "DELETE" })).status).toBe(401);
    expect((await call("/events", { method: "DELETE", token: TOKEN })).status).toBe(401);
    expect(kv.store.size).toBe(3);
    const res = await call("/events", { method: "DELETE", token: VIEW });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deleted: 3 });
    expect(kv.store.size).toBe(0);
    expect((await (await call("/events", { token: VIEW })).json()).events).toEqual([]);
  });

  it("serves the viewer page without touching KV", async () => {
    await ingest({ ...daily(1), summary_markdown: "STORED-MARKER" });
    kv.calls.length = 0;
    const res = await call("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/^text\/html/);
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const html = await res.text();
    expect(html).not.toContain("STORED-MARKER");
    expect(html).not.toContain(TOKEN);
    expect(html).not.toContain(VIEW);
    for (const asset of ["/viewer.js", "/viewer.css"]) {
      const r = await call(asset);
      expect(r.status).toBe(200);
      expect(await r.text()).not.toContain("STORED-MARKER");
    }
    expect(kv.calls).toEqual([]);
  });

  it("returns 404 for unknown paths and 405 for unsupported methods", async () => {
    expect((await call("/nope")).status).toBe(404);
    expect((await call("/events", { method: "PUT", token: VIEW })).status).toBe(405);
    expect((await call("/", { method: "PUT" })).status).toBe(405);
  });

  it("never logs in inbox mode", async () => {
    await ingest({ ...daily(1), summary_markdown: "SECRET-BODY-TEXT" });
    await ingest("{nope SECRET-BODY-TEXT");
    await call("/", { method: "POST", token: "wrong", body: daily(1) });
    await call("/events", { token: VIEW });
    await call("/events", { method: "DELETE", token: VIEW });
    await call("/");
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});

describe("review mode", () => {
  for (const mode of [undefined, "review", "INBOX", ""]) {
    it(`stores nothing and 404s the viewer when MODE is ${JSON.stringify(mode)}`, async () => {
      const reviewEnv = { MODE: mode, WEBHOOK_TOKEN: TOKEN, VIEW_TOKEN: VIEW, EVENTS: kv };
      const res = await ingest(daily(1), {}, reviewEnv);
      expect(res.status).toBe(200);
      expect((await call("/", { environment: reviewEnv })).status).toBe(404);
      expect((await call("/viewer.js", { environment: reviewEnv })).status).toBe(404);
      expect((await call("/events", { token: VIEW, environment: reviewEnv })).status).toBe(404);
      expect((await call("/events", { method: "DELETE", token: VIEW, environment: reviewEnv })).status).toBe(404);
      expect(kv.calls).toEqual([]);
    });
  }
});
