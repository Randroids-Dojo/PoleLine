# PoleLine

Draw the lap. Take pole.

PoleLine is a mobile web game set on 24 real Formula 1 circuits. You draw your racing line around the track with a finger, choose soft, medium or hard tyres, and a modern F1 car runs exactly that line in real time. Go wide, clip the apex, close the loop where you started. Every circuit has its own world leaderboard, and each lap tells you which grid slot it would have earned against real pole pace.

## How it plays

- **Draw.** Start on the chequered line and drag along the track. The map is zoomed to a comfortable finger width and turns so the road ahead points up. When you near the edge of the screen your stroke ends and the map glides on; lift and carry on from the purple tip. Prefer one long stroke? Settings has a continuous mode where the map scrolls under your finger, with a speed slider. Cross the white line and your stroke stops at the edge; undo that stroke and try the corner again. Only a line that stays inside the limits can be raced.
- **Race.** The screen stays awake (Screen Wake Lock) while you play. The car runs your line in real time: flying lap, live sector colours, delta to your personal best ghost, gear, revs, DRS and tyre temperature.
- **Learn.** The results sheet shows a speed trace of the whole lap, your sectors, a grid slot (P1 to P20, or outside 107%) and a race engineer's note on what to try next.

## The simulation

`src/sim` is a deterministic quasi-steady-state lap simulator shared by the browser and the leaderboard API:

- Lines are stored as decimetre integers. That integer list is the lap: the same line on the same tyre at the same circuit always produces the same time, on every device and on the server.
- The car cannot follow fingertip wobble, so the line is smoothed over a speed-dependent window (a few metres in a hairpin, ~16 m on a 300 km/h straight).
- Corner speeds come from tyre grip plus downforce, with load sensitivity. Downforce and drag use airspeed, so each circuit's locked wind matters. Power, traction and braking limits share a friction ellipse. DRS opens on the long straights.
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

Track geometry is generated:

```bash
npm run tracks:build       # data-src/*.geojson -> src/data
npm run tracks:calibrate   # recompute per-circuit grip, then run tracks:build again
```

## Data and credits

Circuit outlines come from [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) (MIT, see `data-src/F1-CIRCUITS-LICENSE.md`). Pole pace references are approximate modern-era dry qualifying times.

PoleLine is an unofficial fan project and is not associated with Formula 1 or the FIA. F1, Formula 1 and related marks are trademarks of Formula One Licensing B.V.
