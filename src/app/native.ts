// The native shell (Capacitor) when the game runs as the Toybox mobile app:
// splash screen, haptics, keeping the screen awake, sharing and the Android
// back button. In a browser every call is a no-op and nothing here is loaded.

export interface NativeHandlers {
  /** Android back button: return true when handled (a sheet closed, a screen popped), false to leave the app. */
  back(): boolean;
}

export async function initNative(_handlers: NativeHandlers): Promise<void> {}

/** Plays a haptic cue; returns false when there is no native haptics engine. */
export function haptic(_pattern: number | number[]): boolean {
  return false;
}

/** The native share sheet; resolves false when it is not available. */
export async function shareText(_title: string, _text: string): Promise<boolean> {
  return false;
}

/** Keep the screen on (native); no-op in a browser, where wake.ts holds the lock. */
export async function keepAwake(_on: boolean): Promise<void> {}
