export class FakeKV {
  constructor() {
    this.store = new Map();
    this.puts = [];
    this.calls = [];
    this.failOn = new Set();
  }

  check(op) {
    this.calls.push(op);
    if (this.failOn.has(op)) throw new Error(`kv ${op} failed`);
  }

  async put(key, value, options = {}) {
    this.check("put");
    this.puts.push({ key, value, options });
    this.store.set(key, value);
  }

  async get(key, type) {
    this.check("get");
    const value = this.store.get(key);
    if (value === undefined) return null;
    return type === "json" ? JSON.parse(value) : value;
  }

  async list({ prefix = "" } = {}) {
    this.check("list");
    const keys = [...this.store.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name }));
    return { keys, list_complete: true };
  }

  async delete(key) {
    this.check("delete");
    this.store.delete(key);
  }
}
