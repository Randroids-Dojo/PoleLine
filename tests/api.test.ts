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
  zrange: async (key: string, a: number, b: number) => ranked(key).slice(a, b + 1).flatMap(([m, s]) => [m, s]),
  hset: async (key: string, obj: Record<string, string>) => {
    for (const [k, v] of Object.entries(obj)) hash(key).set(k, v);
    return 1;
  },
  hget: async (key: string, f: string) => hash(key).get(f) ?? null,
  hmget: async (key: string, ...f: string[]) => Object.fromEntries(f.map((x) => [x, hash(key).get(x) ?? null])),
  hgetall: async (key: string) => Object.fromEntries(hash(key).entries()),
  set: async (k: string, v: string) => {
    store.s.set(k, v);
    return 'OK';
  },
  pipeline() {
    const ops: (() => Promise<unknown>)[] = [];
    const p: Record<string, unknown> = {
      exec: async () => {
        const out = [];
        for (const op of ops) out.push(await op());
        return out;
      },
    };
    for (const name of ['zrange', 'zcard', 'zrank', 'zscore', 'hset', 'hget']) {
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

process.env.KV_REST_API_URL = 'https://example.test';
process.env.KV_REST_API_TOKEN = 'token';
const { default: handler, cleanName, scoreLine } = await import('../api/leaderboard');

function call(method: string, query: Record<string, string> = {}, body?: unknown) {
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
  return handler({ method, query, body, headers: { 'x-forwarded-for': '1.2.3.4' } }, res).then(() => ({ status, json: json as Record<string, unknown> }));
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

  it('rejects malformed submissions', async () => {
    const r = await call('POST', {}, { track: 'nowhere', compound: 'soft', line: [1, 2], playerId: P1, name: 'X' });
    expect(r.status).toBe(400);
    const r2 = await call('POST', {}, { track: 'monaco', compound: 'soft', line: centre.slice(0, 200), playerId: P1, name: 'Shorty' });
    expect(r2.status).toBe(422);
  });
});
