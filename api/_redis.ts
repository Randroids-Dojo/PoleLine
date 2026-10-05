// Shared Upstash client for the API routes (files starting with _ are not routes).

import { Redis } from '@upstash/redis';

let client: Redis | null = null;

export function redis(): Redis {
  if (client) return client;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('Leaderboard store is not configured');
  client = new Redis({ url, token });
  return client;
}
