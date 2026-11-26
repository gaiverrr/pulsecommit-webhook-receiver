import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";

const TOKEN = "test-token-123";
const env = { WEBHOOK_TOKEN: TOKEN };

function post(body, { token = TOKEN, contentType = "application/json", method = "POST", path = "/" } = {}) {
  const headers = {};
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  if (contentType !== null) headers["Content-Type"] = contentType;
  const init = { method, headers };
  if (method !== "GET" && method !== "HEAD") init.body = typeof body === "string" ? body : JSON.stringify(body);
  return worker.fetch(new Request(`https://example.com${path}`, init), env);
}

const daily = { event_type: "daily_export", date: "2026-11-23", summary: { steps: 1 } };

let spies;
beforeEach(() => {
  spies = ["log", "info", "warn", "error", "debug"].map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => vi.restoreAllMocks());

describe("receiver", () => {
  it("accepts a daily_export", async () => {
    const body = JSON.stringify(daily);
    const res = await post(body);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, event_type: "daily_export", bytes: new TextEncoder().encode(body).length });
  });

  it("accepts a test event without summary or date", async () => {
    const res = await post({ event_type: "test" });
    expect(res.status).toBe(200);
    expect((await res.json()).event_type).toBe("test");
  });

  it("accepts a charset parameter on content type", async () => {
    expect((await post(daily, { contentType: "application/json; charset=utf-8" })).status).toBe(200);
  });

  it("rejects non-POST with 405", async () => {
    expect((await post("", { method: "GET" })).status).toBe(405);
    expect((await post("", { method: "PUT" })).status).toBe(405);
  });

  it("rejects other paths with 405", async () => {
    expect((await post(daily, { path: "/x" })).status).toBe(405);
  });

  it("rejects missing and wrong tokens with 401", async () => {
    expect((await post(daily, { token: null })).status).toBe(401);
    expect((await post(daily, { token: "wrong" })).status).toBe(401);
    expect((await post(daily, { token: TOKEN + "x" })).status).toBe(401);
  });

  it("rejects everything when the secret is not configured", async () => {
    const res = await worker.fetch(
      new Request("https://example.com/", { method: "POST", headers: { Authorization: "Bearer x", "Content-Type": "application/json" }, body: "{}" }),
      {},
    );
    expect(res.status).toBe(401);
  });

  it("requires application/json with 415", async () => {
    expect((await post(daily, { contentType: "text/plain" })).status).toBe(415);
    expect((await post(daily, { contentType: null })).status).toBe(415);
  });

  it("returns 413 above 1 MB", async () => {
    const big = JSON.stringify({ event_type: "test", pad: "a".repeat(1024 * 1024) });
    expect((await post(big)).status).toBe(413);
  });

  it("returns 413 when content-length is above 1 MB", async () => {
    const req = new Request("https://example.com/", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", "Content-Length": String(2 * 1024 * 1024) },
      body: "{}",
    });
    expect((await worker.fetch(req, env)).status).toBe(413);
  });

  it("returns 400 for invalid JSON", async () => {
    expect((await post("{nope")).status).toBe(400);
  });

  it("returns 400 for non-object JSON", async () => {
    expect((await post("[]")).status).toBe(400);
    expect((await post("null")).status).toBe(400);
  });

  it("returns 400 for an unknown event_type", async () => {
    expect((await post({ event_type: "other" })).status).toBe(400);
    expect((await post({})).status).toBe(400);
  });

  it("returns 400 for daily_export without summary object or date string", async () => {
    expect((await post({ event_type: "daily_export", date: "2026-11-23" })).status).toBe(400);
    expect((await post({ event_type: "daily_export", date: "2026-11-23", summary: [] })).status).toBe(400);
    expect((await post({ event_type: "daily_export", summary: {} })).status).toBe(400);
    expect((await post({ event_type: "daily_export", summary: {}, date: 5 })).status).toBe(400);
  });

  it("returns 413 for a chunked body above 1 MB without Content-Length", async () => {
    const chunk = new TextEncoder().encode("a".repeat(64 * 1024));
    let sent = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (sent >= 20) return controller.close();
        sent++;
        controller.enqueue(chunk);
      },
    });
    const req = new Request("https://example.com/", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: stream,
      duplex: "half",
    });
    expect(req.headers.get("Content-Length")).toBeNull();
    expect((await worker.fetch(req, env)).status).toBe(413);
  });

  it("returns 500 without logging when the body stream errors mid-read", async () => {
    let n = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (n++ === 0) return controller.enqueue(new TextEncoder().encode('{"event_type":'));
        controller.error(new Error("client aborted SECRET-BODY-TEXT"));
      },
    });
    const req = new Request("https://example.com/", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: stream,
      duplex: "half",
    });
    const res = await worker.fetch(req, env);
    expect([400, 500]).toContain(res.status);
    expect(await res.json()).toEqual({ ok: false, error: "internal" });
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  it("never logs and never echoes body or token", async () => {
    const secretBody = { ...daily, summary_markdown: "SECRET-BODY-TEXT" };
    const res = await post(secretBody);
    const text = await res.text();
    expect(text).not.toContain("SECRET-BODY-TEXT");
    expect(text).not.toContain(TOKEN);
    await post("{nope SECRET-BODY-TEXT");
    await post(secretBody, { token: "wrong" });
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});
