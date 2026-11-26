# Pulse Commit minimal webhook receiver

A Cloudflare Worker that accepts the Pulse Commit webhook, checks the token, validates the body and discards it. It stores nothing, logs nothing and has no bindings. It also serves as the test endpoint for Pulse Commit's Webhook destination.

## What it does

- `POST /` only. Any other method or path returns 405.
- `Authorization: Bearer <token>` is compared in constant time with the `WEBHOOK_TOKEN` secret. Missing or wrong token returns 401. This Worker only accepts `Authorization: Bearer <token>`, so the header name in the app must stay `Authorization`. If the secret is not set, every request returns 401.
- `Content-Type` must be `application/json` (415 otherwise). Body limit is 1 MB (413 above).
- The JSON body must be an object with `event_type` of `daily_export` or `test`. For `daily_export` it also needs a `summary` object and a `date` string. Otherwise 400.
- Success returns `200 {"ok":true,"event_type":"...","bytes":N}`.
- Body and headers are never stored, logged or echoed. `wrangler.jsonc` disables observability and Logpush.

## Deploy

```sh
cd receivers/cloudflare-worker
npm ci
npx wrangler secret put WEBHOOK_TOKEN
npx wrangler deploy
```

Generate a token with `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`, or use the Generate button in the app and paste the same value into `wrangler secret put`.

## Point Pulse Commit at it

1. In Pulse Commit open Destinations, Webhook.
2. URL: the `https://pulsecommit-webhook-receiver.<your-subdomain>.workers.dev` address printed by `wrangler deploy`.
3. Token: the value you stored in `WEBHOOK_TOKEN`. Leave the header name as `Authorization`.
4. Tap Send test. The receiver answers `200` with `"event_type":"test"`.

## Try it locally

Create `.dev.vars` (ignored by Git) and start the dev server:

```sh
echo 'WEBHOOK_TOKEN=test-token-123' > .dev.vars
npx wrangler dev --port 8799
```

```sh
curl -i -X POST http://localhost:8799/ \
  -H 'Authorization: Bearer test-token-123' \
  -H 'Content-Type: application/json' \
  -d '{"schema_version":"1.0","event_type":"daily_export","date":"2026-11-23","summary":{"steps":1234}}'
```

Expected: `HTTP/1.1 200 OK` and `{"ok":true,"event_type":"daily_export","bytes":97}`.

## Tests

```sh
npm test
npx wrangler deploy --dry-run
```

## Optional variants

These are snippets, not part of the deployed Worker. Add them after the validation in `src/index.js`, where `payload` is the parsed body.

### Store each day in R2

Add to `wrangler.jsonc`:

```jsonc
"r2_buckets": [{ "binding": "EXPORTS", "bucket_name": "pulsecommit-exports" }]
```

Then, before the final `return json(200, ...)`:

```js
if (payload.event_type === "daily_export") {
  await env.EXPORTS.put(`${payload.date}.json`, JSON.stringify(payload), {
    httpMetadata: { contentType: "application/json" },
  });
}
```

Keying by `date` keeps one object per day, so a re-run overwrites the earlier one. This variant keeps your Health data in your own bucket.

### Forward the summary text to another URL

Add `FORWARD_URL` as a secret, then:

```js
if (payload.event_type === "daily_export" && typeof payload.summary_markdown === "string") {
  const upstream = await fetch(env.FORWARD_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: payload.summary_markdown }),
  });
  if (!upstream.ok) return json(502, { ok: false, error: "forward_failed" });
}
```

Whoever runs the forward target can read what it receives.

## Privacy

Pulse Commit does not run this server. If you deploy it, you operate it. The unmodified Worker discards every body.
