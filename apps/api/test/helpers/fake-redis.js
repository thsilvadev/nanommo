/** Minimal in-memory ioredis stand-in for direct-execution tests (strings, hashes, lists, pub/sub capture). */
function createFakeRedis(now = () => Date.now()) {
  const strings = new Map(); const hashes = new Map(); const lists = new Map(); const expiries = new Map();
  const published = [];
  const alive = (key) => { const e = expiries.get(key); if (e !== undefined && e <= now()) { strings.delete(key); hashes.delete(key); lists.delete(key); expiries.delete(key); } };
  const hash = (key) => { alive(key); if (!hashes.has(key)) hashes.set(key, new Map()); return hashes.get(key); };
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const redis = {
    published, strings, hashes, lists,
    async set(key, value, ...args) {
      await tick(); alive(key);
      const upper = args.map((a) => String(a).toUpperCase());
      if (upper.includes('NX') && strings.has(key)) return null;
      strings.set(key, String(value));
      const px = upper.indexOf('PX'); const ex = upper.indexOf('EX');
      if (px >= 0) expiries.set(key, now() + Number(args[px + 1]));
      else if (ex >= 0) expiries.set(key, now() + Number(args[ex + 1]) * 1000);
      return 'OK';
    },
    async get(key) { await tick(); alive(key); return strings.get(key) ?? null; },
    async del(...keys) { await tick(); let n = 0; for (const k of keys.flat()) { n += strings.delete(k) || hashes.delete(k) || lists.delete(k) ? 1 : 0; } return n; },
    async expire(key, seconds) { await tick(); expiries.set(key, now() + seconds * 1000); return 1; },
    async incrby(key, by) { await tick(); alive(key); const v = Number(strings.get(key) ?? 0) + Number(by); strings.set(key, String(v)); return v; },
    async decr(key) { return redis.incrby(key, -1); },
    async hset(key, ...args) { await tick(); const h = hash(key); if (args.length === 1 && typeof args[0] === 'object') { for (const [f, v] of Object.entries(args[0])) h.set(f, String(v)); return 1; } for (let i = 0; i < args.length; i += 2) h.set(String(args[i]), String(args[i + 1])); return 1; },
    async hsetnx(key, field, value) { await tick(); const h = hash(key); if (h.has(field)) return 0; h.set(field, String(value)); return 1; },
    async hget(key, field) { await tick(); return hash(key).get(field) ?? null; },
    async hgetall(key) { await tick(); return Object.fromEntries(hash(key)); },
    async hkeys(key) { await tick(); return [...hash(key).keys()]; },
    async hdel(key, ...fields) { await tick(); const h = hash(key); let n = 0; for (const f of fields) n += h.delete(f) ? 1 : 0; return n; },
    async lpush(key, ...values) { await tick(); alive(key); if (!lists.has(key)) lists.set(key, []); lists.get(key).unshift(...values.map(String)); return lists.get(key).length; },
    async lrange(key, start, stop) { await tick(); const l = lists.get(key) ?? []; return l.slice(start, stop < 0 ? undefined : stop + 1); },
    async ltrim(key, start, stop) { await tick(); const l = lists.get(key) ?? []; lists.set(key, l.slice(start, stop + 1)); return 'OK'; },
    async publish(channel, message) { await tick(); published.push({ channel, payload: JSON.parse(message) }); return 1; },
    multi() {
      const ops = [];
      const m = new Proxy({}, { get: (_t, prop) => prop === 'exec' ? async () => { const out = []; for (const [name, args] of ops) out.push([null, await redis[name](...args)]); return out; } : (...args) => { ops.push([prop, args]); return m; } });
      return m;
    },
  };
  return redis;
}
module.exports = { createFakeRedis };
