// Renders the source art @capacitor/assets needs from public/icon.svg:
// icon-only (the full icon), icon-foreground (road, line and dot on a clear
// background, scaled for Android's adaptive mask), icon-background (solid
// black) and a paper splash with the icon centred.
//
//   node mobile/assets/make.mjs && npm run mobile:assets

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(here, '..', '..', 'public', 'icon.svg'), 'utf8');
const PAPER = '#eef1f4';

/** The icon without its rounded black plate. */
const art = svg.replace(/<rect[^>]*\/>\s*/, '');

function page(size, body) {
  return `<html><body style="margin:0;width:${size}px;height:${size}px;background:transparent;display:grid;place-items:center">${body}</body></html>`;
}

const sized = (markup, px) => markup.replace('<svg ', `<svg width="${px}" height="${px}" `);

const b = await chromium.launch();
const p = await b.newPage();
const shots = [
  ['icon-only.png', 1024, page(1024, sized(svg, 1024)), true],
  ['icon-foreground.png', 1024, page(1024, sized(art, Math.round(1024 * 0.66))), true],
  ['icon-background.png', 1024, `<html><body style="margin:0;width:1024px;height:1024px;background:#000"></body></html>`, false],
  ['splash.png', 2732, `<html><body style="margin:0;width:2732px;height:2732px;background:${PAPER};display:grid;place-items:center">${sized(svg, Math.round(2732 * 0.2))}</body></html>`, false],
  ['splash-dark.png', 2732, `<html><body style="margin:0;width:2732px;height:2732px;background:${PAPER};display:grid;place-items:center">${sized(svg, Math.round(2732 * 0.2))}</body></html>`, false],
];
for (const [file, size, html, transparent] of shots) {
  await p.setViewportSize({ width: size, height: size });
  await p.setContent(html);
  await p.screenshot({ path: join(here, file), omitBackground: transparent });
  console.log('wrote', file);
}
await b.close();
