// Spots a newer deploy while the game is open: the build knows its own
// version, and /version.json (never cached) holds the live one. Checked every
// minute and whenever the game comes back to the foreground.

const POLL_MS = 60_000;

export const APP_VERSION = __APP_VERSION__;

/** The live version if it differs from `current`, else null. Never throws. */
export async function newerVersion(current: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  if (!current || current === 'dev') return null;
  try {
    const res = await fetcher('/version.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const { version } = (await res.json()) as { version?: unknown };
    return typeof version === 'string' && version && version !== current ? version : null;
  } catch {
    return null;
  }
}

/** Calls `onUpdate` once per newer version found. */
export function watchForUpdates(onUpdate: (version: string) => void): void {
  if (APP_VERSION === 'dev') return;
  let told = '';
  let checking = false;
  const check = async () => {
    if (checking || document.visibilityState !== 'visible') return;
    checking = true;
    const v = await newerVersion(APP_VERSION);
    checking = false;
    if (v && v !== told) {
      told = v;
      onUpdate(v);
    }
  };
  setInterval(() => void check(), POLL_MS);
  window.addEventListener('focus', () => void check());
  document.addEventListener('visibilitychange', () => void check());
  void check();
}
