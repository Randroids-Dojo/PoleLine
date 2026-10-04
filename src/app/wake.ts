// Keeps the screen from dimming while the game is open (Screen Wake Lock API).
// The lock drops whenever the page is hidden, so it is re-requested when the
// page becomes visible again and on the next touch (some browsers only grant
// it after a user gesture).

let lock: WakeLockSentinel | null = null;
let wanted = false;
let requesting = false;

async function acquire(): Promise<void> {
  if (!wanted || lock || requesting || document.visibilityState !== 'visible') return;
  if (!('wakeLock' in navigator)) return;
  requesting = true;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => {
      lock = null;
    });
  } catch {
    /* denied (battery saver, unsupported context): the game still works */
  } finally {
    requesting = false;
  }
}

export function setKeepAwake(on: boolean): void {
  wanted = on;
  if (on) void acquire();
  else if (lock) {
    void lock.release().catch(() => {});
    lock = null;
  }
}

document.addEventListener('visibilitychange', () => void acquire());
document.addEventListener('pointerdown', () => void acquire(), { passive: true, capture: true });
