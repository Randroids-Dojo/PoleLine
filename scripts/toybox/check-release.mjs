// Checks a Toybox build (dist-toybox) before it goes near a store: no real
// circuit, place or team names, no server routes, no service worker or
// update polling, and the made-up catalog in place of the real one.
//
//   node scripts/toybox/check-release.mjs [dist-toybox]

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'dist-toybox';
const banned = [
  /Formula ?1|\bF1\b/, /Silverstone/, /Monaco/, /Monza/, /Suzuka/, /Spa-Francorchamps/, /Albert Park/, /Hungaroring/, /Zandvoort/, /Interlagos/, /Yas Marina/,
  /Jeddah/, /Lusail/, /Las Vegas/, /Circuit of the Americas/, /Hermanos/, /Gilles Villeneuve/, /Red Bull/, /McLaren/, /Ferrari/, /Mercedes/, /Aston Martin/,
  /Alpine/, /Williams/, /Racing Bulls/, /\bAudi\b/, /\bHaas\b/, /Cadillac/, /bacinger/,
  /\/api\/leaderboard/, /\/api\/push/, /world leaderboard/, /version\.json/, /serviceWorker\.register|\/sw\.js/, /beforeinstallprompt/, /PushManager/,
];
const required = [/Harbour Loop/, /Kestrel Park/, /Aurora Point/, /Rookie Ring/, /Your times/, /Kestrel Racing/];

function files(d) {
  const out = [];
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(js|html|css)$/.test(name)) out.push(p);
  }
  return out;
}

let problems = 0;
const seen = new Set();
for (const f of files(dir)) {
  if (f.endsWith('sw.js')) continue; // copied from public/, never registered by this edition
  const text = readFileSync(f, 'utf8');
  for (const re of banned) {
    const m = text.match(re);
    if (m) {
      console.log(`${f}: contains "${m[0]}"`);
      problems++;
    }
  }
  for (const re of required) if (re.test(text)) seen.add(String(re));
}
for (const re of required) {
  if (!seen.has(String(re))) {
    console.log(`no file contains ${re}`);
    problems++;
  }
}
console.log(problems ? `${problems} problem(s) in ${dir}` : `${dir} is clean: made-up circuits and teams only, no server routes`);
process.exit(problems ? 1 : 0);
