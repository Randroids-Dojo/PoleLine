// Native shell for the local-only mobile edition. The game itself is the Vite
// build in dist-toybox (npm run build:toybox); this file only shapes the shell.
import type { CapacitorConfig } from '@capacitor/cli';

const PAPER = '#eef1f4';

const config: CapacitorConfig = {
  appId: 'app.toyboxes.poleline',
  appName: 'PoleLine',
  webDir: 'dist-toybox',
  // Nothing is ever fetched: the bundle is served from the app package.
  server: { androidScheme: 'https', iosScheme: 'capacitor' },
  android: {
    path: 'mobile/android',
    allowMixedContent: false,
    backgroundColor: PAPER,
  },
  ios: {
    path: 'mobile/ios',
    contentInset: 'never',
    scrollEnabled: false,
    backgroundColor: PAPER,
  },
  plugins: {
    SplashScreen: {
      // The game hides the splash itself once its first frame is on screen
      // (SplashScreen.hide()); the duration is only a safety net, and a
      // duration of 0 would switch the plugin's splash off entirely.
      launchAutoHide: true,
      launchShowDuration: 3000,
      backgroundColor: PAPER,
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: false,
      splashImmersive: false,
    },
    SystemBars: {
      // Edge to edge; the game already lays out with env(safe-area-inset-*).
      insetsHandling: 'native',
      initialViewportFitValueHint: 'cover',
      // Dark icons over the paper background.
      style: 'LIGHT',
      hidden: false,
      animation: 'NONE',
    },
  },
};

export default config;
