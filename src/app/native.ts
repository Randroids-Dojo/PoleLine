// The native shell (Capacitor) when the game runs as the Toybox mobile app:
// splash screen, haptics, keeping the screen awake, sharing and the Android
// back button. In a browser every call is a no-op, and the web edition never
// loads any of the plugin code.

import { LOCAL_ONLY } from './edition';
import { setKeepAwake } from './wake';
import { getSettings } from './store';

export interface NativeHandlers {
  /** Android back button: return true when handled (a sheet closed, a screen popped), false to leave the app. */
  back(): boolean;
}

type Impact = 'Light' | 'Medium' | 'Heavy';
interface Bridge {
  impact(style: Impact): void;
  vibrate(ms: number): void;
  share(title: string, text: string): Promise<void>;
  keepAwake(on: boolean): Promise<void>;
}

let bridge: Bridge | null = null;

export async function initNative(handlers: NativeHandlers): Promise<void> {
  if (!LOCAL_ONLY) return;
  const { Capacitor } = await import('@capacitor/core');
  if (!Capacitor.isNativePlatform()) return;
  const [{ App }, { Haptics, ImpactStyle }, { SplashScreen }, { Share }, { KeepAwake }] = await Promise.all([
    import('@capacitor/app'),
    import('@capacitor/haptics'),
    import('@capacitor/splash-screen'),
    import('@capacitor/share'),
    import('@capacitor-community/keep-awake'),
  ]);
  bridge = {
    impact: (style) => void Haptics.impact({ style: ImpactStyle[style] }).catch(() => {}),
    vibrate: (ms) => void Haptics.vibrate({ duration: ms }).catch(() => {}),
    share: (title, text) => Share.share({ title, text, dialogTitle: title }).then(() => undefined),
    keepAwake: (on) => (on ? KeepAwake.keepAwake() : KeepAwake.allowSleep()).catch(() => {}),
  };
  // The native plugin holds the screen on; the browser wake lock is not needed on top.
  setKeepAwake(false);
  await bridge.keepAwake(getSettings().keepAwake);
  await App.addListener('backButton', () => {
    if (!handlers.back()) void App.exitApp();
  });
  // The game's first frame is on screen by the time this module has loaded.
  requestAnimationFrame(() => void SplashScreen.hide({ fadeOutDuration: 180 }).catch(() => {}));
}

/**
 * Plays a haptic cue in place of navigator.vibrate: short ticks become light
 * impacts, longer buzzes medium or heavy ones, and patterns a vibration of
 * their total length. Returns false when there is no native haptics engine.
 */
export function haptic(pattern: number | number[]): boolean {
  if (!bridge) return false;
  if (Array.isArray(pattern)) {
    const total = pattern.reduce((a, b) => a + b, 0);
    if (total >= 120) bridge.vibrate(total);
    else bridge.impact('Heavy');
    return true;
  }
  bridge.impact(pattern <= 10 ? 'Light' : pattern <= 16 ? 'Medium' : 'Heavy');
  return true;
}

/** The native share sheet; resolves false when it is not available. */
export async function shareText(title: string, text: string): Promise<boolean> {
  if (!bridge) return false;
  try {
    await bridge.share(title, text);
    return true;
  } catch {
    return false;
  }
}

/** Keep the screen on through the native plugin (the settings switch calls this as well as wake.ts). */
export async function keepAwake(on: boolean): Promise<void> {
  await bridge?.keepAwake(on);
}
