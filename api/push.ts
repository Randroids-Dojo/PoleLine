// Lap alert subscriptions (Web Push, see api/_push.ts).
//
// GET    /api/push                          -> {publicKey} for PushManager.subscribe
// POST   /api/push {playerId, subscription} -> store (or refresh) this device's subscription
// DELETE /api/push {playerId}               -> stop alerts for this player

import { z } from 'zod';
import { PUSH_PREFIX, saveSubscription, subKey, subscriptionSchema, vapidKeys } from './_push.js';
import { redis } from './_redis.js';

interface Req {
  method?: string;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
}
interface Res {
  status(code: number): Res;
  json(body: unknown): Res;
  setHeader(name: string, value: string): void;
  end(): Res;
}

const RATE_WINDOW = 60;
const RATE_MAX = 20;
const playerId = z.string().regex(/^[a-f0-9-]{16,40}$/);
const saveSchema = z.object({ playerId, subscription: subscriptionSchema });
const dropSchema = z.object({ playerId });

function clientIp(req: Req): string {
  const fwd = req.headers['x-forwarded-for'];
  const v = Array.isArray(fwd) ? fwd[0] : fwd ?? '';
  return v.split(',')[0].trim() || 'unknown';
}

export default async function handler(req: Req, res: Res): Promise<Res> {
  try {
    if (req.method === 'GET') {
      const keys = vapidKeys();
      if (!keys) return res.status(503).json({ error: 'alerts are not set up' });
      res.setHeader('Cache-Control', 'public, s-maxage=3600');
      return res.status(200).json({ publicKey: keys.publicKey });
    }
    if (req.method !== 'POST' && req.method !== 'DELETE') return res.status(405).json({ error: 'method not allowed' });

    const kv = redis();
    const rl = `${PUSH_PREFIX}rl:${clientIp(req)}`;
    const hits = await kv.incr(rl);
    if (hits === 1) await kv.expire(rl, RATE_WINDOW);
    if (hits > RATE_MAX) return res.status(429).json({ error: 'too many requests' });

    if (req.method === 'POST') {
      const parsed = saveSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: 'bad subscription' });
      await saveSubscription(kv, parsed.data.playerId, parsed.data.subscription);
      return res.status(200).json({ ok: true });
    }
    const parsed = dropSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: 'bad request' });
    await kv.del(subKey(parsed.data.playerId));
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('push route error', err instanceof Error ? err.message : err);
    return res.status(500).json({ error: 'alerts unavailable' });
  }
}
