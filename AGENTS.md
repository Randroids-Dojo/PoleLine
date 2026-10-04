# AGENTS.md

Rules for any coding agent working in PoleLine.

## Product

A mobile web game. The player draws a racing line around a real F1 circuit with a finger, picks a tyre, and the car runs that line in real time. Times go on a per-circuit global leaderboard. Keep the core loop tight: pick circuit, pick tyre, draw, watch, read the result, go again.

## Rules

1. **No em dashes or en dashes.** Not in code, comments, copy, commits or PRs. Use a period, comma, colon or parentheses.
2. **Commit messages and PR descriptions read as written by a human.** No AI attribution, no generated-by footers.
3. **`src/sim` must stay deterministic.** It runs in the browser and in `api/leaderboard.ts`, and the same quantised line plus tyre must give the same lap time on every JS engine. On the timing path use only `+ - * /`, `Math.sqrt`, comparisons and `Math.floor/round`. No `Math.sin/cos/exp/pow/atan2/hypot`, no randomness, no DOM. Relative imports inside `src/sim` and `src/data` keep their `.js` extension (the Vercel function runs as ESM).
4. **Track data is generated.** Edit `scripts/track-config.ts`, then run `npm run tracks:build`. After any physics change run `npm run tracks:calibrate` and then `npm run tracks:build` again so each circuit's ideal lap stays just under real pole pace.
5. **Copy is sentence case and plain.** Purple, green and yellow keep their F1 timing meanings.
6. Never commit `.env*` files or print secrets.

## Commands

```bash
npm run dev          # Vite on :5199 (API routes need `vercel dev`)
npm run typecheck
npm test             # sim + API tests
npm run build
npx tsx scripts/playtest.ts spielberg ideal /tmp/play   # scripted phone playtest with screenshots (dev server running)
npx tsx scripts/calibrate.ts --report                  # lap times, tyre gaps, sensitivity per circuit
```
