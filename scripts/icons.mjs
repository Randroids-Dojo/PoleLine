import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const svg = readFileSync('public/icon.svg', 'utf8');
const b = await chromium.launch();
const p = await b.newPage();
for (const [size, file, pad] of [[180, 'public/apple-touch-icon.png', 0], [192, 'public/icon-192.png', 0], [512, 'public/icon-512.png', 0]]) {
  await p.setViewportSize({ width: size, height: size });
  const inner = file.includes('apple') ? svg.replace('rx="112"', 'rx="0"') : svg;
  await p.setContent(`<html><body style="margin:0;background:transparent">${inner.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await p.screenshot({ path: file, omitBackground: true });
}
await p.setViewportSize({ width: 1200, height: 630 });
const css = `@font-face{font-family:A;src:url(data:font/woff2;base64,${readFileSync('node_modules/@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2').toString('base64')}) format('woff2');font-weight:100 900;font-stretch:62% 125%}`;
await p.setContent(`<html><head><style>${css} body{margin:0;width:1200px;height:630px;background:#eef1f4;font-family:A;display:flex;align-items:center;gap:56px;padding:0 80px;box-sizing:border-box}
h1{font-size:132px;font-weight:900;font-stretch:125%;letter-spacing:-0.04em;margin:0;line-height:0.9} p{font-size:40px;margin:22px 0 0;font-weight:600;color:#4b535d} .u{height:16px;margin-top:10px}</style></head><body>
${svg.replace('<svg ', '<svg width="300" height="300" ')}<div><h1>PoleLine</h1><svg class="u" viewBox="0 0 120 9" width="560" preserveAspectRatio="none"><path d="M2 6 C 30 9, 50 1, 75 4 S 110 7, 118 2" fill="none" stroke="#9b30ff" stroke-width="3" stroke-linecap="round"/></svg><p>Draw the lap. Take pole.</p></div></body></html>`);
await p.waitForTimeout(300);
await p.screenshot({ path: 'public/og.png' });
await b.close();
