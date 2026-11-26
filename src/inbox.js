const PREFIX = "evt:";
const KEEP = 50;
const TTL_SECONDS = 7 * 24 * 60 * 60;
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

function safeId(value) {
  return typeof value === "string" && SAFE_ID.test(value) ? value : null;
}

async function listKeys(kv) {
  const names = [];
  let cursor;
  do {
    const page = await kv.list({ prefix: PREFIX, cursor });
    for (const k of page.keys) names.push(k.name);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return names.sort();
}

export async function storeEvent(kv, request, payload, bytes) {
  const receivedAt = new Date().toISOString();
  const idempotencyKey = safeId(request.headers.get("Idempotency-Key")) ?? safeId(payload.idempotency_key);
  const key = `${PREFIX}${receivedAt}:${idempotencyKey ?? crypto.randomUUID()}`;
  const record = {
    received_at: receivedAt,
    event_type: payload.event_type,
    date: typeof payload.date === "string" ? payload.date : null,
    idempotency_key: idempotencyKey,
    user_agent: (request.headers.get("User-Agent") ?? "").slice(0, 200) || null,
    bytes,
    body: payload,
  };
  await kv.put(key, JSON.stringify(record), { expirationTtl: TTL_SECONDS });
  try {
    const names = await listKeys(kv);
    const stale = names.slice(0, Math.max(0, names.length - KEEP));
    await Promise.all(stale.map((name) => kv.delete(name)));
  } catch {}
}

export async function latestEvents(kv) {
  const names = (await listKeys(kv)).slice(-KEEP).reverse();
  const records = await Promise.all(names.map((name) => kv.get(name, "json")));
  return records.flatMap((record, i) => (record ? [{ id: names[i], ...record }] : []));
}

export async function clearEvents(kv) {
  const names = await listKeys(kv);
  await Promise.all(names.map((name) => kv.delete(name)));
  return names.length;
}
