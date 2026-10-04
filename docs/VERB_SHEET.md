# Core interaction

Genre and intended pace: precision drawing puzzle with a real-time payoff. Deliberate while drawing, spectator while the lap runs.
Intended input and accessible alternatives: one finger (or mouse) dragging on the map. Lift and resume at the tip. Undo stroke and restart are buttons.
Viewing mode: overhead map, zoomed so the legal track is about 52 CSS px wide, rotated so the road ahead points up.
Representative starting state: any circuit, `Draw a lap` from home, fresh line.

| Player action | Input | Consequence | Constraint, uncertainty, or tradeoff | Acknowledgment and result feedback | Verification |
| --- | --- | --- | --- | --- | --- |
| Start the lap | Touch the chequered line | First point snaps onto the start line at the touched lateral position | Must start within 16 m of the line | Pulsing start band and demo fingertip until touched, pen-down blip, hint changes | `scripts/touchtest.ts`, `scripts/playtest.ts` step 2 |
| Draw the line | Drag | Purple ink extends exactly under the finger; map feeds forward when the tip runs out of room ahead (applied once per frame) | Track limits, corner geometry, finger precision; ink only flows forward | Ink, tip ring, progress bar and percent, minimap, red edge glow plus haptic tick within 1.2 m of the limit | Touch test draws a full lap with real touch events |
| Lift and resume | Release, then touch within 58 px of the tip | Camera glides to frame the next section; resumed stroke eases from the tip onto the finger | Touch too far from the tip is rejected | Lift blip, glide, pulsing tip; rejection flashes the hint and pulses the tip | Playtest strokes, manual |
| Leave the track | Ink crosses the outer edge of the white line | Lap deleted, input stops | Rule from the brief: no undo after a failure | Red flash, X at the exit point, buzz, `Track limits` card with `Draw again` | `playtest.ts monaco offtrack` |
| Close the loop | Cross the start line after a full lap | Line validated, lap simulated, race starts | Lateral gap between start and finish costs time | Start marker appears after 70%, `Lap drawn` stamp | Playtests |
| Watch the lap | None (Skip available) | Real-time playback of the simulated lap | Tyre temperature, wind, downforce, line quality | Timer, live delta to best, sector colours, speed, gear, LEDs, DRS, tyre temp, engine sound, finish card | Playtest frames 5 to 6c |
| Read the result | None, then `Draw again` | Grid slot or pace ladder, PB saved, leaderboard post | Pole means beating real pole pace | Camera pulls back to a speed trace, stamp, sectors, engineer's notes, confetti on PB | Playtest frame 7 |

## Smallest useful test

Largest risk: drawing a precise line on a phone. Tested by drawing complete laps with real touch events at 390x844.

## First action and recovery

First action is visible on arrival: pulsing chequered band, chevrons and an animated fingertip. Failure ends the attempt with a clear reason and a one-tap restart. Muted audio loses nothing essential; every cue has a visual twin.

## Done when

A full lap can be drawn with touch input, a failure is legible and recoverable in one tap, and the race and results present the same time the server records. Evidence: `scripts/touchtest.ts`, `scripts/playtest.ts`, `tests/`.
Remaining human judgment: drawing comfort and conveyor feel on a physical phone, and whether the difficulty ladder feels fair.
