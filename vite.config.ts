import { execSync } from 'node:child_process';
import { defineConfig, type Plugin } from 'vite';

/** Identifies this build: the deployed commit, else the local commit, else the build time. */
function buildVersion(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return `build-${Date.now()}`;
  }
}

/** Writes /version.json next to the app so open copies can spot a newer deploy. */
function versionFile(version: string): Plugin {
  return {
    name: 'poleline-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version }) });
    },
  };
}

/**
 * The Toybox edition (VITE_EDITION=toybox) swaps the circuit data for the
 * made-up set under src/data/toybox at import time, so game code keeps one
 * import path and the real circuits never reach the mobile bundle.
 */
const edition = process.env.VITE_EDITION === 'toybox' ? 'toybox' : 'web';
const toyboxAliases = [
  { find: /\/data\/catalog$/, replacement: '/data/toybox/catalog' },
  { find: /\/data\/geometry-loaders$/, replacement: '/data/toybox/geometry-loaders' },
];

/** The app shell needs no manifest, icons, share image or install metadata, and its copy names no real series. */
function toyboxHtml(): Plugin {
  return {
    name: 'poleline-toybox-html',
    transformIndexHtml(html) {
      return html
        .replace(/<meta name="description" content="[^"]*" \/>/, '<meta name="description" content="Draw your racing line with your finger, then watch the car run it flat out. Twenty circuits, all on your phone." />')
        .replace(/\n\s*<meta property="og:[^\n]*/g, '')
        .replace(/\n\s*<link rel="(icon|apple-touch-icon|manifest)"[^\n]*/g, '');
    },
  };
}

export default defineConfig(({ command }) => {
  const version = command === 'build' ? buildVersion() : 'dev';
  return {
    server: { port: 5199 },
    build: { target: 'es2022', sourcemap: true },
    define: { __APP_VERSION__: JSON.stringify(version), __EDITION__: JSON.stringify(edition) },
    resolve: { alias: edition === 'toybox' ? toyboxAliases : [] },
    // The shell serves nothing from public/: no service worker, manifest or version file.
    publicDir: edition === 'toybox' ? false : 'public',
    plugins: [edition === 'toybox' ? toyboxHtml() : versionFile(version)],
  };
});
