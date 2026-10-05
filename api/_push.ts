// Lap alerts over Web Push: storing subscriptions, and telling players when a
// new lap passes theirs on a circuit board.
//
// Keys (not versioned by SIM_VERSION, a subscription outlives a physics reset):
//   poleline:push:sub:<playerId>          the browser's push subscription (JSON)
//   poleline:push:quiet:<playerId>:<slug> set for a while after an alert, so a
//                                         run of laps sends one notification
//   poleline:push:rl:<ip>                 rate-limit counter

import type { Redis } from '@upstash/redis';
import webpush from 'web-push';
import { z } from 'zod';
import { formatLap } from '../src/app/format.js';

export const PUSH_PREFIX = 'poleline:push:';
/** Subscriptions expire unless the app refreshes them, which it does on every open. */
const SUB_TTL = 60 * 60 * 24 * 180;
const QUIET = 15 * 60;
/** Most players told about one lap. */
const MAX_ALERTS = 25;

/** The browsers' push services. Anything else is refused so the server never posts to arbitrary hosts. */
const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'push.apple.com', 'push.services.mozilla.com', 'notify.windows.com'];

function knownPushService(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export const subscriptionSchema = z.object({
  endpoint: z.string().max(1024).refine(knownPushService, 'unknown push service'),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: z.string().min(16).max(256), auth: z.string().min(8).max(64) }),
});
export type PushSubscription = z.infer<typeof subscriptionSchema>;

export const subKey = (playerId: string) => `${PUSH_PREFIX}sub:${playerId}`;

export async function saveSubscription(kv: Redis, playerId: string, sub: PushSubscription): Promise<void> {
  await kv.set(subKey(playerId), JSON.stringify(sub), { ex: SUB_TTL });
}

export function vapidKeys(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: process.env.VAPID_SUBJECT || 'https://pole-line.vercel.app' };
}

export interface AlertMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export function beatenMessage(a: { by: string; track: string; slug: string; timeMs: number; yourMs: number; rank: number }): AlertMessage {
  const gap = ((a.yourMs - a.timeMs) / 1000).toFixed(3);
  return {
    title: `${a.by} beat your ${a.track} time`,
    body: `${formatLap(a.timeMs)}, ${gap} s quicker than your ${formatLap(a.yourMs)}. You're now world #${a.rank} on ${a.track}.`,
    url: `/?track=${a.slug}&board=1`,
    tag: `beaten-${a.slug}`,
  };
}

function parse(v: unknown): PushSubscription | null {
  if (!v) return null;
  try {
    const sub = typeof v === 'string' ? JSON.parse(v) : v;
    return subscriptionSchema.safeParse(sub).success ? (sub as PushSubscription) : null;
  } catch {
    return null;
  }
}

/**
 * A new best just moved a player up a board. Everyone whose time sat between
 * their old best and the new one has been passed: tell each of them once.
 */
export async function alertPassed(
  kv: Redis,
  a: { board: string; slug: string; track: string; by: string; timeMs: number; beforeMs: number | null },
): Promise<number> {
  const keys = vapidKeys();
  if (!keys) return 0;
  const raw = (await kv.zrange(a.board, `(${a.timeMs}`, a.beforeMs === null ? '+inf' : `(${a.beforeMs}`, {
    byScore: true,
    withScores: true,
    offset: 0,
    count: MAX_ALERTS,
  })) as (string | number)[];
  const passed: { id: string; ms: number }[] = [];
  for (let i = 0; i < raw.length; i += 2) passed.push({ id: String(raw[i]), ms: Number(raw[i + 1]) });
  if (!passed.length) return 0;

  const p = kv.pipeline();
  for (const x of passed) p.get(subKey(x.id));
  for (const x of passed) p.zrank(a.board, x.id);
  const out = (await p.exec()) as unknown[];
  let sent = 0;
  await Promise.all(
    passed.map(async (x, i) => {
      const sub = parse(out[i]);
      if (!sub) return;
      const fresh = await kv.set(`${PUSH_PREFIX}quiet:${x.id}:${a.slug}`, 1, { nx: true, ex: QUIET });
      if (fresh !== 'OK') return;
      const rank = Number(out[passed.length + i]) + 1;
      const msg = beatenMessage({ by: a.by, track: a.track, slug: a.slug, timeMs: a.timeMs, yourMs: x.ms, rank });
      try {
        await webpush.sendNotification(sub, JSON.stringify(msg), { TTL: 60 * 60 * 24, urgency: 'normal', timeout: 5000, vapidDetails: keys });
        sent++;
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        // The browser dropped the subscription: forget it.
        if (code === 404 || code === 410) await kv.del(subKey(x.id));
        else console.error('push failed', code ?? (err instanceof Error ? err.message : err));
      }
    }),
  );
  return sent;
}
