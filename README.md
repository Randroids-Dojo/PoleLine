# PoleLine

Draw the lap. Take pole.

PoleLine is a mobile web game set on 24 real Formula 1 circuits. You draw your racing line around the track with a finger, choose soft, medium or hard tyres, and a modern F1 car runs exactly that line in real time. Go wide, clip the apex, close the loop where you started. Every circuit has its own world leaderboard, and each lap tells you which grid slot it would have earned against real pole pace.

## How it plays

- **Learn on the Rookie Ring.** First launch opens a guided walkthrough on a made-up 1.6 km tutorial circuit (pole 30.000 s, so a whole lap is worth watching). The lap is drawn for you up to the final corner: a welcome, a flight along the drawn line, a tyre choice (it is 55°C on track, so mediums are quickest), then you draw the last corner with a dotted guide and live tips, watch the car run it with captions, and choose to try again or continue to the 24 rounds. Skipping or finishing is remembered, so later launches open on the circuit list. The Rookie Ring stays first in that list, marked Tutorial: draw the last corner again or replay the walkthrough. It has its own leaderboard and replays, and the server only accepts tutorial laps that start from the drawn line, so the board is about that one corner.
- **Pick tyres, then draw.** Before your first stroke the bar at the bottom of the drawing screen picks soft, medium or hard (it remembers your choice per circuit, and shows that circuit's tyre tip). Start on the chequered line and drag along the track. The map is zoomed to a comfortable finger width and turns so the road ahead points up. When you near the edge of the screen your stroke ends and the map glides on; lift and carry on from the purple tip. Swipe on the grass to look around at any time; a button glides you back to the tip. The compass in the corner turns the map: tap it to put north, east, south or west at the top, or drag it to any angle. Auto-rotation (the road ahead points up) can be switched off with the compass's Auto pill or in Settings. Prefer one long stroke? Settings has a continuous mode where the map scrolls under your finger, with a speed slider (0.35x by default) and an optional "Slow down near corners" setting with four styles to experiment with. Cross the white line and your stroke stops at the edge; undo that stroke and try the corner again. Only a line that stays inside the limits can be raced.
- **Your car.** A 2026-shape car in PoleLine purple or the colours of any of the eleven 2026 teams (loose colour impressions, no logos). Switch it under Your car in Settings.
- **Race.** The screen stays awake (Screen Wake Lock) while you play. The car runs your line in real time: flying lap, live sector colours, delta to your personal best ghost, gear, revs, active aero (straight mode), the battery and tyre temperature.
- **Learn.** The results sheet shows a speed trace of the whole lap, your sectors, a grid slot (P1 to P20; anything slower lines up P20) and a race engineer's note on what to try next, with the lap's telemetry folded under Lap details. Each circuit's locked conditions sit behind its Conditions button.
- **Watch any lap.** The top 100 laps on each board keep their drawn line. Tap a driver and Watch: their lap re-simulates exactly and runs in real time against the current P1 as a ghost (or against your own best when watching P1), with the live gap and sector colours against the ghost.
- **Copy a rival.** Every best lap on a leaderboard carries the setup it was drawn with (scroll mode and speed, corner slowdown, map rotation and tyre). Tap a driver to see it and copy it in one tap; your next lap on that circuit draws the same way.
- **Stay in the fight.** After your first lap the game offers to go on your home screen (the browser's install prompt on Android and desktop, Share then Add to Home Screen on iPhone), then to turn on lap alerts: a push notification when someone beats one of your times, which opens that circuit's leaderboard. Each prompt shows once; Settings keeps an Add to home screen row and a lap alerts switch for later. On iPhone they work from the home screen app.

## The simulation

`src/sim` is a deterministic quasi-steady-state lap simulator shared by the browser and the leaderboard API:

- Lines are stored as decimetre integers. That integer list is the lap: the same line on the same tyre at the same circuit always produces the same time, on every device and on the server.
- The car cannot follow fingertip wobble, so the line is smoothed over a speed-dependent window (a few metres in a hairpin, ~16 m on a 300 km/h straight).
- The car follows the 2026 regulations (approximately): about 780 kg, less downforce and drag than the 2022 to 2025 cars, and active aerodynamics instead of DRS. On each circuit's designated straights the wings flatten into straight mode, and they close into corner mode whenever the car brakes.
- Corner speeds come from tyre grip plus downforce, with load sensitivity. Downforce and drag use airspeed, so each circuit's locked wind matters. Power, traction and braking limits share a friction ellipse.
- The power unit is roughly half electric: ~400 kW from the engine plus up to 350 kW from the MGU-K, which tapers away above 290 km/h. The battery (4 MJ window) starts the lap charged, recharges under braking and by super clipping at the end of straights (at most 8.5 MJ a lap), and the car's energy map deploys fully below a cut-off speed and clips above it. That cut-off is the highest one the battery can sustain for the lap, so a line that wastes energy clips earlier.
- A tyre thermal model integrates sliding energy around the lap. Softs are quickest when they stay in their window, but they can overheat on hot, high-energy circuits, and hards never switch on in the cold.
- Each circuit has locked conditions (air and track temperature, wind, altitude and air density, downforce trim, surface grip). Surface grip is calibrated so a minimum-curvature line on softs lands about 1.5% under real-world pole pace.

## Development

```bash
npm install
npm run dev        # http://localhost:5199
npm test
npm run build
```

The leaderboard route (`api/leaderboard.ts`) runs on Vercel and needs Upstash Redis credentials (`KV_REST_API_URL`, `KV_REST_API_TOKEN`), which the Vercel Marketplace integration injects. Use `vercel dev` to run it locally. Without them the game still works and keeps personal bests on the device.

Each build bakes in its version (the deployed commit) and writes it to `/version.json`, which is never cached. An open game checks that file every minute and when it returns to the foreground; when a newer deploy is live it offers a refresh banner on the home and results screens (never mid-lap).

Lap alerts (`api/push.ts`, `api/_push.ts`, `public/sw.js`) use Web Push with VAPID keys in `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`. A new best alerts every player it passed on that circuit's board, at most once per player and circuit every 15 minutes. Generate a key pair with `npx web-push generate-vapid-keys`; without keys the route reports alerts as unavailable and nothing is sent.

Track geometry is generated:

```bash
npm run tracks:build       # data-src/*.geojson -> src/data, then the tutorial line (src/data/tutorial.ts)
npm run tracks:calibrate   # recompute per-circuit grip, then run tracks:build again
npx tsx scripts/rookie-ring.ts   # regenerate the tutorial circuit's outline from its plan of straights and arcs
```

The tutorial circuit is calibrated on mediums (its conditions are chosen so they are the quickest tyre); every other circuit is calibrated on softs.

## Data and credits

Circuit outlines come from [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) (MIT, see `data-src/F1-CIRCUITS-LICENSE.md`). Pole pace references are approximate modern-era dry qualifying times.

PoleLine is an unofficial fan project and is not associated with Formula 1 or the FIA. F1, Formula 1 and related marks are trademarks of Formula One Licensing B.V.
