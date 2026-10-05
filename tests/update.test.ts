import { describe, expect, it, vi } from 'vitest';
import { newerVersion } from '../src/app/update';

const serve = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('update check', () => {
  it('reports a different live version', async () => {
    const f = serve({ version: 'b2' });
    expect(await newerVersion('a1', f)).toBe('b2');
    expect(f).toHaveBeenCalledWith('/version.json', { cache: 'no-store' });
  });

  it('stays quiet on the same version, in dev, and on bad responses', async () => {
    expect(await newerVersion('a1', serve({ version: 'a1' }))).toBeNull();
    const dev = serve({ version: 'b2' });
    expect(await newerVersion('dev', dev)).toBeNull();
    expect(dev).not.toHaveBeenCalled();
    expect(await newerVersion('a1', serve({ version: 'b2' }, 404))).toBeNull();
    expect(await newerVersion('a1', serve({ nope: true }))).toBeNull();
    const offline = vi.fn(async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    expect(await newerVersion('a1', offline)).toBeNull();
  });
});
