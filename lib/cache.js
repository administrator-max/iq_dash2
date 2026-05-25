/**
 * lib/cache.js — Two-tier cache (in-memory L1 + Redis L2) with
 * singleflight de-dup and cross-instance invalidation via Redis pub/sub.
 *
 * Activation: Redis only engages when REDIS_URL env var is set. Without
 * it, this module degrades to a pure in-memory cache — identical
 * behavior to the previous `_dataCache` object in server.js. That keeps
 * local dev (no Redis) working unchanged.
 *
 * Why two tiers?
 *   L1 (per-process Map) → ~0 ms hit, but lost on restart and not shared
 *                          between dynos.
 *   L2 (Redis)           → ~2-10 ms hit (local TCP), survives restart,
 *                          shared across every running instance.
 *
 * Read path: L1 → L2 → builder(). On L2 hit, also fill L1.
 * Write path: builder runs once (singleflight), result written to both
 * tiers, then `invalidate(key)` removes it from both AND broadcasts a
 * pub/sub message so other instances flush their L1.
 */
const INVALIDATE_CHANNEL = 'iq_dash:invalidate';

// ── In-memory L1 ─────────────────────────────────────────────────────
const _mem = new Map();          // key → { value, expiresAt }
const _inflight = new Map();     // key → Promise (singleflight)

function memGet(key) {
  const hit = _mem.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) { _mem.delete(key); return undefined; }
  return hit.value;
}
function memSet(key, value, ttlSec) {
  _mem.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
}
function memDel(key) { _mem.delete(key); }

// ── Redis L2 (lazy, optional) ────────────────────────────────────────
let _redis     = null;   // main client (GET/SET/DEL)
let _redisSub  = null;   // pub/sub subscriber (a second connection is required)
let _redisReady = false;
let _redisAttempted = false;

async function initRedis() {
  if (_redisAttempted) return _redisReady;
  _redisAttempted = true;
  if (!process.env.REDIS_URL) {
    console.log('[cache] REDIS_URL not set → in-memory only');
    return false;
  }
  try {
    const { createClient } = require('redis');
    const url = process.env.REDIS_URL;

    // Use TLS automatically for rediss:// URLs (Upstash, Redis Cloud, etc).
    // Most managed providers require SNI + standard TLS — no special config
    // beyond the rediss:// scheme.
    _redis = createClient({
      url,
      socket: {
        // Don't reconnect forever — back off and surface failure so we
        // fall back to in-memory rather than blocking requests.
        reconnectStrategy: (retries) => {
          if (retries > 5) return new Error('redis: too many retries');
          return Math.min(retries * 200, 2000);
        },
        connectTimeout: 5_000,
      },
    });
    _redisSub = _redis.duplicate();

    _redis.on('error',    e => console.warn('[cache] redis error:', e.message));
    _redisSub.on('error', e => console.warn('[cache] redis sub error:', e.message));

    await _redis.connect();
    await _redisSub.connect();

    // Cross-instance invalidation: other dynos publish key names here,
    // we drop them from our local L1 so the next read goes to L2/builder.
    await _redisSub.subscribe(INVALIDATE_CHANNEL, (msg) => {
      if (!msg) return;
      if (msg === '*') {
        _mem.clear();
        console.log('[cache] received broadcast flush');
      } else {
        memDel(msg);
      }
    });

    _redisReady = true;
    console.log(`[cache] redis connected (${url.replace(/:[^:@]*@/, ':***@')})`);
    return true;
  } catch (e) {
    console.warn('[cache] redis init failed → in-memory only:', e.message);
    _redis = null;
    _redisSub = null;
    _redisReady = false;
    return false;
  }
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Get-or-build with two-tier caching + singleflight.
 *
 * @param {string} key       Cache key (e.g. 'iq:data:v1')
 * @param {number} ttlSec    Time-to-live in seconds for both L1 and L2
 * @param {Function} builder Async function that produces the value on miss
 * @returns {Promise<{value:any, source:'L1'|'L2'|'BUILD'|'COALESCED'}>}
 */
async function getOrBuild(key, ttlSec, builder) {
  // L1
  const l1 = memGet(key);
  if (l1 !== undefined) return { value: l1, source: 'L1' };

  // Singleflight: piggyback on an in-flight build for the same key
  const pending = _inflight.get(key);
  if (pending) {
    const value = await pending;
    return { value, source: 'COALESCED' };
  }

  // L2 (Redis) — only if connected
  if (_redisReady) {
    try {
      const raw = await _redis.get(key);
      if (raw != null) {
        const value = JSON.parse(raw);
        memSet(key, value, ttlSec); // populate L1
        return { value, source: 'L2' };
      }
    } catch (e) {
      console.warn(`[cache] L2 GET failed for ${key}:`, e.message);
      // fall through to build
    }
  }

  // Miss → build (singleflight)
  const buildPromise = (async () => {
    const value = await builder();
    memSet(key, value, ttlSec);
    if (_redisReady) {
      try {
        await _redis.set(key, JSON.stringify(value), { EX: ttlSec });
      } catch (e) {
        console.warn(`[cache] L2 SET failed for ${key}:`, e.message);
      }
    }
    return value;
  })();
  _inflight.set(key, buildPromise);
  try {
    const value = await buildPromise;
    return { value, source: 'BUILD' };
  } finally {
    _inflight.delete(key);
  }
}

/**
 * Invalidate a key from both tiers, then broadcast to other instances.
 * Safe to call without arguments — that wipes everything (use sparingly).
 */
async function invalidate(key) {
  if (!key || key === '*') {
    _mem.clear();
    if (_redisReady) {
      try {
        // Be cautious: only flush keys we own (prefixed `iq:`).
        const keys = await _redis.keys('iq:*');
        if (keys.length) await _redis.del(keys);
        await _redis.publish(INVALIDATE_CHANNEL, '*');
      } catch (e) { console.warn('[cache] L2 flush failed:', e.message); }
    }
    return;
  }
  memDel(key);
  if (_redisReady) {
    try {
      await _redis.del(key);
      await _redis.publish(INVALIDATE_CHANNEL, key);
    } catch (e) {
      console.warn(`[cache] invalidate ${key} failed:`, e.message);
    }
  }
}

/**
 * Invalidate every key whose name starts with `prefix`. Useful when a
 * single PATCH affects many keyed slices (e.g. all `iq:realizations:*`
 * once a realization is inserted).
 */
async function invalidatePrefix(prefix) {
  for (const k of _mem.keys()) {
    if (k.startsWith(prefix)) memDel(k);
  }
  if (_redisReady) {
    try {
      const keys = await _redis.keys(`${prefix}*`);
      if (keys.length) {
        await _redis.del(keys);
        // Broadcast each so other instances clear their L1 entries.
        for (const k of keys) await _redis.publish(INVALIDATE_CHANNEL, k);
      }
    } catch (e) {
      console.warn(`[cache] invalidatePrefix ${prefix} failed:`, e.message);
    }
  }
}

function isRedisReady() { return _redisReady; }

async function closeRedis() {
  if (_redisSub) { try { await _redisSub.quit(); } catch (_) {} }
  if (_redis)    { try { await _redis.quit(); }    catch (_) {} }
}

module.exports = {
  initRedis,
  getOrBuild,
  invalidate,
  invalidatePrefix,
  isRedisReady,
  closeRedis,
};
