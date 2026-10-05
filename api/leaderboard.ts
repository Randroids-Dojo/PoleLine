// PoleLine global leaderboard (Vercel Node function, Upstash Redis).
//
// GET  /api/leaderboard?track=<slug>&player=<id>&limit=50  -> board for a circuit
// GET  /api/leaderboard?summary=1                          -> fastest lap per circuit
// POST /api/leaderboard {track, compound, line, playerId, name, setup?}
// PATCH /api/leaderboard {playerId, name}                   -> rename everywhere
//
// A submission carries the drawn line itself (decimetre integer deltas), never
// a claimed time. The server re-validates track limits and re-runs the same
// deterministic simulation the browser ran, so the time on the board is the
// server's. Each player keeps only their best lap per circuit, along with the
// drawing setup it was drawn with (scroll mode and speed, corner damping,
// auto-rotate) so others can copy it.
//
// Keys (shared store, so everything is prefixed `poleline:v<SIM_VERSION>:`):
//   lb:<slug>    sorted set, member = playerId, score = lap ms
//   meta:<slug>  hash, playerId -> {name, compound, timeMs, date, setup?}
//   records      hash, slug -> {name, compound, timeMs}
//   wr:<slug>    string, the record lap's line (for a future ghost)
//   rl:<ip>      rate-limit counter
//
// A new best also alerts the players it passed (api/_push.ts), after the
// response has gone.

import { waitUntil } from '@vercel/functions';
import { z } from 'zod';
import { CATALOG } from '../src/data/catalog.js';
import { GEOMETRY } from '../src/data/geometry-all.js';
import { simulateLap } from '../src/sim/lapsim.js';
import { MAX_POINTS, decodePath, validatePath } from '../src/sim/path.js';
import { buildTrack, type Track } from '../src/sim/track.js';
import { SIM_VERSION } from '../src/sim/version.js';
import { alertPassed } from './_push.js';
import { redis } from './_redis.js';

interface Req {
  method?: string;
  query: Record<string, string | string[] | undefined>;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
}
interface Res {
  status(code: number): Res;
  json(body: unknown): Res;
  setHeader(name: string, value: string): void;
  end(): Res;
}

const PREFIX = `poleline:v${SIM_VERSION}:`;
const MAX_LIMIT = 100;
const RATE_WINDOW = 60;
const RATE_MAX = 20;
const SLUGS = CATALOG.map((m) => m.slug) as [string, ...string[]];

const BLOCKED = ['fuck', 'shit', 'cunt', 'nigg', 'fag', 'rape', 'nazi', 'hitler', 'bitch', 'whore', 'slut', 'dick', 'cock', 'pussy'];

export function cleanName(raw: string): string | null {
  const name = raw.replace(/[^A-Za-z0-9 _.-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14);
  if (name.length < 2) return null;
  const flat = name.toLowerCase().replace(/[^a-z]/g, '');
  if (BLOCKED.some((w) => flat.includes(w))) return null;
  return name;
}

const submitSchema = z.object({
  track: z.enum(SLUGS),
  compound: z.enum(['soft', 'medium', 'hard']),
  line: z
    .array(z.number().int().min(-200000).max(200000))
    .min(40)
    .max(MAX_POINTS * 2)
    .refine((a) => a.length % 2 === 0, 'line must have x,y pairs'),
  playerId: z.string().regex(/^[a-f0-9-]{16,40}$/),
  name: z.string().max(64),
  setup: z.unknown().optional(),
});

/** Drawing settings a lap was drawn with. A malformed setup is dropped, never the lap. */
const setupSchema = z.object({
  scrollMode: z.enum(['pause', 'continuous']),
  scrollSpeed: z.number().min(0.25).max(2),
  cornerDamping: z.enum(['off', 'gentle', 'early', 'hold', 'pace']),
  autoRotate: z.boolean(),
});
type Setup = z.infer<typeof setupSchema>;

const boardSchema = z.object({
  track: z.enum(SLUGS),
  player: z.string().regex(/^[a-f0-9-]{16,40}$/).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
});

const tracks = new Map<string, Track>();
function track(slug: string): Track {
  let t = tracks.get(slug);
  if (!t) {
    const meta = CATALOG.find((m) => m.slug === slug)!;
    t = buildTrack(meta, GEOMETRY[slug]);
    tracks.set(slug, t);
  }
  return t;
}

/** Pure scoring step, exported for tests: line in, server-authoritative lap out. */
export function scoreLine(slug: string, line: number[], compound: 'soft' | 'medium' | 'hard'): { ok: true; timeMs: number } | { ok: false; error: string } {
  const t = track(slug);
  const pts = decodePath(line);
  const v = validatePath(t, pts);
  if (!v.ok) return { ok: false, error: `line rejected (${v.error})` };
  const lap = simulateLap(t, pts, compound);
  if (!Number.isFinite(lap.timeMs) || lap.timeMs < t.meta.poleRef * 1000 * 0.8) return { ok: false, error: 'lap time out of range' };
  return { ok: true, timeMs: lap.timeMs };
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function clientIp(req: Req): string {
  const fwd = first(req.headers['x-forwarded-for']) ?? '';
  return fwd.split(',')[0].trim() || first(req.headers['x-real-ip']) || 'unknown';
}

interface Meta {
  name: string;
  compound: string;
  timeMs: number;
  date: string;
  setup?: Setup;
}

function parseMeta(v: unknown): Meta | null {
  if (!v) return null;
  if (typeof v === 'object') return v as Meta;
  try {
    return JSON.parse(String(v)) as Meta;
  } catch {
    return null;
  }
}

async function getSummary(res: Res): Promise<Res> {
  const all = (await redis().hgetall(`${PREFIX}records`)) as Record<string, unknown> | null;
  const records: Record<string, unknown> = {};
  for (const [slug, v] of Object.entries(all ?? {})) {
    const m = parseMeta(v);
    if (m) records[slug] = { name: m.name, timeMs: m.timeMs, compound: m.compound };
  }
  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
  return res.status(200).json({ records });
}

async function getBoard(req: Req, res: Res): Promise<Res> {
  const parsed = boardSchema.safeParse({ track: first(req.query.track), player: first(req.query.player), limit: first(req.query.limit) });
  if (!parsed.success) return res.status(400).json({ error: 'bad query' });
  const { track: slug, player } = parsed.data;
  const limit = parsed.data.limit ?? 50;
  const kv = redis();
  const key = `${PREFIX}lb:${slug}`;
  const p = kv.pipeline();
  p.zrange(key, 0, limit - 1, { withScores: true });
  p.zcard(key);
  if (player) {
    p.zrank(key, player);
    p.zscore(key, player);
  }
  const out = (await p.exec()) as unknown[];
  const raw = (out[0] as (string | number)[]) ?? [];
  const total = Number(out[1] ?? 0);
  const ids: string[] = [];
  const scores: number[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    ids.push(String(raw[i]));
    scores.push(Number(raw[i + 1]));
  }
  const metas = ids.length ? ((await kv.hmget(`${PREFIX}meta:${slug}`, ...ids)) as Record<string, unknown> | null) : null;
  const entries = ids.map((id, i) => {
    const m = parseMeta(metas?.[id]);
    return { rank: i + 1, name: m?.name ?? 'Driver', timeMs: scores[i], compound: m?.compound ?? 'soft', date: m?.date ?? '', setup: m?.setup ?? null, you: id === player };
  });
  let you: { rank: number; timeMs: number } | null = null;
  if (player && out[2] !== null && out[2] !== undefined) you = { rank: Number(out[2]) + 1, timeMs: Number(out[3]) };
  res.setHeader('Cache-Control', 'private, max-age=5');
  return res.status(200).json({ entries, total, you });
}

async function post(req: Req, res: Res): Promise<Res> {
  const parsed = submitSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'bad submission' });
  const body = parsed.data;
  const name = cleanName(body.name);
  if (!name) return res.status(400).json({ error: 'choose a different name' });

  const kv = redis();
  const rlKey = `${PREFIX}rl:${clientIp(req)}`;
  const hits = await kv.incr(rlKey);
  if (hits === 1) await kv.expire(rlKey, RATE_WINDOW);
  if (hits > RATE_MAX) return res.status(429).json({ error: 'too many laps, take a breather' });

  const scored = scoreLine(body.track, body.line, body.compound);
  if (!scored.ok) return res.status(422).json({ error: scored.error });
  const timeMs = scored.timeMs;

  const key = `${PREFIX}lb:${body.track}`;
  const before = await kv.zscore(key, body.playerId);
  const changed = (await kv.zadd(key, { lt: true, ch: true }, { score: timeMs, member: body.playerId })) as number | null;
  const improved = Number(changed ?? 0) > 0;
  const setup = setupSchema.safeParse(body.setup);
  const meta: Meta = { name, compound: body.compound, timeMs, date: new Date().toISOString(), ...(setup.success ? { setup: setup.data } : {}) };
  const p = kv.pipeline();
  if (improved) p.hset(`${PREFIX}meta:${body.track}`, { [body.playerId]: JSON.stringify(meta) });
  else p.hget(`${PREFIX}meta:${body.track}`, body.playerId);
  p.zrank(key, body.playerId);
  p.zcard(key);
  p.zscore(key, body.playerId);
  const out = (await p.exec()) as unknown[];
  // Keep the player's latest name on their standing entry even when the lap did not improve.
  if (!improved) {
    const prev = parseMeta(out[0]);
    if (prev && prev.name !== name) await kv.hset(`${PREFIX}meta:${body.track}`, { [body.playerId]: JSON.stringify({ ...prev, name }) });
  }
  const rank = out[1] === null || out[1] === undefined ? null : Number(out[1]) + 1;
  const total = Number(out[2] ?? 0);
  const bestMs = Number(out[3] ?? timeMs);
  if (improved && rank === 1) {
    await kv.hset(`${PREFIX}records`, { [body.track]: JSON.stringify(meta) });
    await kv.set(`${PREFIX}wr:${body.track}`, JSON.stringify({ playerId: body.playerId, compound: body.compound, timeMs, line: body.line }));
  }
  if (improved) {
    const short = CATALOG.find((m) => m.slug === body.track)!.short;
    const beforeMs = before === null || before === undefined ? null : Number(before);
    waitUntil(
      alertPassed(kv, { board: key, slug: body.track, track: short, by: name, timeMs, beforeMs }).catch((err) =>
        console.error('lap alerts failed', err instanceof Error ? err.message : err),
      ),
    );
  }
  return res.status(200).json({ timeMs, rank, total, improved, bestMs });
}

const renameSchema = z.object({ playerId: z.string().regex(/^[a-f0-9-]{16,40}$/), name: z.string().max(64) });

async function rename(req: Req, res: Res): Promise<Res> {
  const parsed = renameSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'bad request' });
  const name = cleanName(parsed.data.name);
  if (!name) return res.status(400).json({ error: 'choose a different name' });
  const { playerId } = parsed.data;
  const kv = redis();
  const p = kv.pipeline();
  for (const slug of SLUGS) p.hget(`${PREFIX}meta:${slug}`, playerId);
  p.hgetall(`${PREFIX}records`);
  const out = (await p.exec()) as unknown[];
  const w = kv.pipeline();
  let updated = 0;
  SLUGS.forEach((slug, i) => {
    const m = parseMeta(out[i]);
    if (!m) return;
    updated++;
    w.hset(`${PREFIX}meta:${slug}`, { [playerId]: JSON.stringify({ ...m, name }) });
  });
  // Records hold a copy of the holder's name; refresh any this player owns.
  const records = (out[SLUGS.length] as Record<string, unknown> | null) ?? {};
  for (const slug of SLUGS) {
    const rec = parseMeta(records[slug]);
    const mine = parseMeta(out[SLUGS.indexOf(slug)]);
    if (rec && mine && rec.timeMs === mine.timeMs && rec.date === mine.date) w.hset(`${PREFIX}records`, { [slug]: JSON.stringify({ ...rec, name }) });
  }
  if (updated) await w.exec();
  return res.status(200).json({ name, updated });
}

export default async function handler(req: Req, res: Res): Promise<Res> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    if (req.method === 'GET') return first(req.query.summary) ? await getSummary(res) : await getBoard(req, res);
    if (req.method === 'POST') return await post(req, res);
    if (req.method === 'PATCH') return await rename(req, res);
    return res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    console.error('leaderboard error', err instanceof Error ? err.message : err);
    return res.status(500).json({ error: 'leaderboard unavailable' });
  }
}
