import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CATALOG } from '../src/data/catalog';
import monaco from '../src/data/geometry/monaco';
import { encodePath } from '../src/sim/path';
import { buildTrack } from '../src/sim/track';
import { minCurvatureOffsets, offsetsToLine } from '../scripts/optimal';

// In-memory stand-in for the handful of Upstash commands the route uses.
const store = {
  z: new Map<string, Map<string, number>>(),
  h: new Map<string, Map<string, string>>(),
  s: new Map<string, string>(),
  n: new Map<string, number>(),
};
function zset(key: string) {
  if (!store.z.has(key)) store.z.set(key, new Map());
  return store.z.get(key)!;
}
function hash(key: string) {
  if (!store.h.has(key)) store.h.set(key, new Map());
  return store.h.get(key)!;
}
function ranked(key: string) {
  return [...zset(key).entries()].sort((a, b) => a[1] - b[1]);
}
const fake = {
  incr: async (k: string) => {
    store.n.set(k, (store.n.get(k) ?? 0) + 1);
    return store.n.get(k)!;
  },
  expire: async () => 1,
  zadd: async (key: string, opts: { lt?: boolean }, m: { score: number; member: string }) => {
    const z = zset(key);
    const cur = z.get(m.member);
    if (cur === undefined || !opts.lt || m.score < cur) {
      z.set(m.member, m.score);
      return 1;
    }
    return 0;
  },
  zrank: async (key: string, member: string) => {
    const i = ranked(key).findIndex(([m]) => m === member);
    return i < 0 ? null : i;
  },
  zcard: async (key: string) => zset(key).size,
  zscore: async (key: string, member: string) => zset(key).get(member) ?? null,
  zrange: async (key: string, a: number | string, b: number | string, o?: { byScore?: boolean; offset?: number; count?: number }) => {
    if (!o?.byScore) return ranked(key).slice(Number(a), Number(b) + 1).flatMap(([m, s]) => [m, s]);
    const lo = (v: number | string) => (score: number) => (String(v).startsWith('(') ? score > Number(String(v).slice(1)) : score >= Number(v));
    const hi = (v: number | string) => (score: number) => (v === '+inf' ? true : String(v).startsWith('(') ? score < Number(String(v).slice(1)) : score <= Number(v));
    const inRange = ranked(key).filter(([, sc]) => lo(a)(sc) && hi(b)(sc));
    return inRange.slice(o.offset ?? 0, (o.offset ?? 0) + (o.count ?? inRange.length)).flatMap(([m, sc]) => [m, sc]);
  },
  hset: async (key: string, obj: Record<string, string>) => {
    for (const [k, v] of Object.entries(obj)) hash(key).set(k, v);
    return 1;
  },
  hget: async (key: string, f: string) => hash(key).get(f) ?? null,
  hmget: async (key: string, ...f: string[]) => Object.fromEntries(f.map((x) => [x, hash(key).get(x) ?? null])),
  hgetall: async (key: string) => Object.fromEntries(hash(key).entries()),
  set: async (k: string, v: unknown, o?: { nx?: boolean }) => {
    if (o?.nx && store.s.has(k)) return null;
    store.s.set(k, String(v));
    return 'OK';
  },
  get: async (k: string) => store.s.get(k) ?? null,
  del: async (k: string) => (store.s.delete(k) ? 1 : 0),
  pipeline() {
    const ops: (() => Promise<unknown>)[] = [];
    const p: Record<string, unknown> = {
      exec: async () => {
        const out = [];
        for (const op of ops) out.push(await op());
        return out;
      },
    };
    for (const name of ['zrange', 'zcard', 'zrank', 'zscore', 'hset', 'hget', 'hgetall', 'get']) {
      p[name] = (...args: unknown[]) => {
        ops.push(() => (fake as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[name](...args));
        return p;
      };
    }
    return p;
  },
};

vi.mock('@upstash/redis', () => ({
  Redis: class {
    constructor() {
      return fake;
    }
  },
}));

// Lap alerts: capture what would be pushed, and the work queued after responses.
const pushed: { endpoint: string; msg: { title: string; body: string; url: string } }[] = [];
let pushStatus = 201;
vi.mock('web-push', () => ({
  default: {
    sendNotification: async (sub: { endpoint: string }, payload: string) => {
      if (pushStatus >= 400) throw Object.assign(new Error('push service said no'), { statusCode: pushStatus });
      pushed.push({ endpoint: sub.endpoint, msg: JSON.parse(payload) });
      return { statusCode: pushStatus };
    },
  },
}));
const background: Promise<unknown>[] = [];
vi.mock('@vercel/functions', () => ({ waitUntil: (p: Promise<unknown>) => background.push(p) }));
const settle = () => Promise.all(background.splice(0));

process.env.KV_REST_API_URL = 'https://example.test';
process.env.KV_REST_API_TOKEN = 'token';
process.env.VAPID_PUBLIC_KEY = 'public-key';
process.env.VAPID_PRIVATE_KEY = 'private-key';
const { default: handler, cleanName, scoreLine } = await import('../api/leaderboard');
const { default: pushHandler } = await import('../api/push');

function call(method: string, query: Record<string, string> = {}, body?: unknown, route: typeof handler = handler) {
  let status = 0;
  let json: unknown = null;
  const res = {
    status(c: number) {
      status = c;
      return res;
    },
    json(b: unknown) {
      json = b;
      return res;
    },
    setHeader() {},
    end() {
      return res;
    },
  };
  return route({ method, query, body, headers: { 'x-forwarded-for': '1.2.3.4' } }, res).then(() => ({ status, json: json as Record<string, unknown> }));
}

const meta = CATALOG.find((m) => m.slug === 'monaco')!;
const track = buildTrack(meta, monaco);
const ideal = encodePath(offsetsToLine(track, minCurvatureOffsets(track)));
const centre = encodePath(offsetsToLine(track, new Float64Array(track.n)));
const P1 = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const P2 = '11111111-2222-3333-4444-555555555555';

describe('leaderboard api', () => {
  beforeEach(() => {
    store.z.clear();
    store.h.clear();
    store.s.clear();
    store.n.clear();
  });

  it('scores a line on the server exactly like the client', () => {
    const r = scoreLine('monaco', ideal, 'soft');
    expect(r.ok).toBe(true);
  });

  it('rejects a line that leaves the track', () => {
    const alpha = minCurvatureOffsets(track);
    for (let i = 300; i < 320; i++) alpha[i] = track.limit + 5;
    const r = scoreLine('monaco', encodePath(offsetsToLine(track, alpha)), 'soft');
    expect(r.ok).toBe(false);
  });

  it('cleans names', () => {
    expect(cleanName('  Max   V!! ')).toBe('Max V');
    expect(cleanName('x')).toBeNull();
  });

  it('keeps each player best and ranks the board', async () => {
    const a = await call('POST', {}, { track: 'monaco', compound: 'soft', line: centre, playerId: P1, name: 'Slow' });
    expect(a.status).toBe(200);
    expect(a.json.rank).toBe(1);
    const b = await call('POST', {}, { track: 'monaco', compound: 'soft', line: ideal, playerId: P2, name: 'Fast' });
    expect(b.json.rank).toBe(1);
    expect(b.json.total).toBe(2);
    // A slower lap does not replace a better one.
    const c = await call('POST', {}, { track: 'monaco', compound: 'soft', line: centre, playerId: P2, name: 'Fast' });
    expect(c.json.improved).toBe(false);
    expect(c.json.bestMs).toBe(b.json.timeMs);
    const board = await call('GET', { track: 'monaco', player: P1 });
    const entries = board.json.entries as { name: string; you: boolean }[];
    expect(entries.map((e) => e.name)).toEqual(['Fast', 'Slow']);
    expect(entries[1].you).toBe(true);
    expect(board.json.you).toEqual({ rank: 2, timeMs: a.json.timeMs });
    const summary = await call('GET', { summary: '1' });
    expect((summary.json.records as Record<string, { name: string }>).monaco.name).toBe('Fast');
  });

  it('renames a player everywhere, including records', async () => {
    await call('POST', {}, { track: 'monaco', compound: 'soft', line: ideal, playerId: P1, name: 'Typo' });
    const r = await call('PATCH', {}, { playerId: P1, name: 'Fixed' });
    expect(r.json.updated).toBe(1);
    const board = await call('GET', { track: 'monaco' });
    expect((board.json.entries as { name: string }[])[0].name).toBe('Fixed');
    const summary = await call('GET', { summary: '1' });
    expect((summary.json.records as Record<string, { name: string }>).monaco.name).toBe('Fixed');
  });

  it('rejects malformed submissions', async () => {
    const r = await call('POST', {}, { track: 'nowhere', compound: 'soft', line: [1, 2], playerId: P1, name: 'X' });
    expect(r.status).toBe(400);
    const r2 = await call('POST', {}, { track: 'monaco', compound: 'soft', line: centre.slice(0, 200), playerId: P1, name: 'Shorty' });
    expect(r2.status).toBe(422);
  });
});

const P3 = '99999999-8888-7777-6666-555555555555';
const sub = (id: string) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, expirationTime: null, keys: { p256dh: 'BPx'.padEnd(87, 'a'), auth: 'auth-secret-1234' } });
const subscribe = (playerId: string) => call('POST', {}, { playerId, subscription: sub(playerId) }, pushHandler);

describe('lap alerts', () => {
  beforeEach(() => {
    store.z.clear();
    store.h.clear();
    store.s.clear();
    store.n.clear();
    pushed.length = 0;
    pushStatus = 201;
  });

  it('serves the public key and stores, refuses and drops subscriptions', async () => {
    const key = await call('GET', {}, undefined, pushHandler);
    expect(key.json.publicKey).toBe('public-key');
    expect((await subscribe(P1)).status).toBe(200);
    expect(store.s.get(`poleline:push:sub:${P1}`)).toContain('fcm.googleapis.com');
    const evil = await call('POST', {}, { playerId: P2, subscription: { ...sub(P2), endpoint: 'https://example.com/steal' } }, pushHandler);
    expect(evil.status).toBe(400);
    await call('DELETE', {}, { playerId: P1 }, pushHandler);
    expect(store.s.has(`poleline:push:sub:${P1}`)).toBe(false);
  });

  it('tells a player once when a lap passes theirs', async () => {
    await subscribe(P1);
    await subscribe(P2);
    const slow = await call('POST', {}, { track: 'monaco', compound: 'soft', line: centre, playerId: P1, name: 'Slow' });
    await settle();
    expect(pushed).toHaveLength(0);
    const fast = await call('POST', {}, { track: 'monaco', compound: 'soft', line: ideal, playerId: P2, name: 'Fast' });
    await settle();
    expect(pushed).toHaveLength(1);
    expect(pushed[0].endpoint).toContain(P1);
    expect(pushed[0].msg.title).toBe(`Fast beat your ${meta.short} time`);
    expect(pushed[0].msg.body).toContain(`now world #2 on ${meta.short}`);
    expect(pushed[0].msg.url).toBe('/?track=monaco&board=1');
    const gap = ((Number(slow.json.timeMs) - Number(fast.json.timeMs)) / 1000).toFixed(3);
    expect(pushed[0].msg.body).toContain(`${gap} s quicker`);
    // A third driver matching the leader passes Slow too, but Slow was just told: no repeat.
    // Fast is not passed by an equal time.
    await call('POST', {}, { track: 'monaco', compound: 'soft', line: ideal, playerId: P3, name: 'Third' });
    await settle();
    expect(pushed).toHaveLength(1);
  });

  it('forgets a subscription the browser has dropped', async () => {
    await subscribe(P1);
    await call('POST', {}, { track: 'monaco', compound: 'soft', line: centre, playerId: P1, name: 'Slow' });
    pushStatus = 410;
    await call('POST', {}, { track: 'monaco', compound: 'soft', line: ideal, playerId: P2, name: 'Fast' });
    await settle();
    expect(store.s.has(`poleline:push:sub:${P1}`)).toBe(false);
  });
});
