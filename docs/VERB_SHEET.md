# Core interaction

Genre and intended pace: precision drawing puzzle with a real-time payoff. Deliberate while drawing, spectator while the lap runs.
Intended input and accessible alternatives: one finger (or mouse) dragging on the map. Lift and resume at the tip. Undo stroke and restart are buttons.
Viewing mode: overhead map, zoomed so the legal track is about 52 CSS px wide, rotated so the road ahead points up.
Representative starting state: any circuit, `Draw a lap` from home, fresh line.

| Player action | Input | Consequence | Constraint, uncertainty, or tradeoff | Acknowledgment and result feedback | Verification |
| --- | --- | --- | --- | --- | --- |
| Start the lap | Touch the chequered line | First point snaps onto the start line at the touched lateral position | Must start within 16 m of the line | Pulsing start band and demo fingertip until touched, pen-down blip, hint changes | `scripts/touchtest.ts`, `scripts/playtest.ts` step 2 |
| Draw the line | Drag | Purple ink extends exactly under the finger. The map never moves under a drawing finger by default: when the tip gets within 64 px of the edge ahead, the stroke ends and the map glides on (pause mode). Optional continuous mode feeds the map forward under the finger at a chosen speed (0.25x to 2x, default 0.35x), optionally slowed near corners (Off, Gentle, Brake early, Corner hold, Racing pace; `src/app/damping.ts`), applied once per frame | Track limits, corner geometry, finger precision; ink only flows forward | Ink, tip ring, progress bar and percent, minimap, red edge glow plus haptic tick within 1.2 m of the limit; on auto-advance a lift blip, buzz and the hint "The map moved on" | Touch test and playtest in both modes (`MODE=continuous SPEED=0.5`) |
| Lift and resume | Release, then touch within 58 px of the tip | Camera glides to frame the next section; resumed stroke eases from the tip onto the finger | Touch too far from the tip is rejected | Lift blip, glide, pulsing tip; rejection flashes the hint and pulses the tip | Playtest strokes, manual |
| Leave the track | Ink crosses the outer edge of the white line | The segment is refused: the line stops at the last legal point and the stroke ends | A raced or submitted line must stay inside the limits; the fix is undo (or carry on from the tip) | Red flash, X at the exit point (the map glides so it is not under the card), buzz, `Track limits` card with `Undo stroke` and `Settings` | `playtest.ts monaco offtrack` (goes wide, undoes, finishes) |
| Look around | Drag on grass (anywhere clearly outside the white lines) | Map pans 1:1 under the finger, flicks carry a little momentum; drawing state is untouched | Touches on the asphalt away from the tip still mean drawing, so they do not pan | Map moves; `Back to the tip` (or `Back to the start`) button appears whenever the tip is off screen. Discovery: a one-time animated hand drags across a patch of grass at the first pause after a stroke (any touch dismisses it), and tapping the grass without dragging flashes "Drag on the grass to move the map." | `scripts/pantest.ts`, `scripts/compasstest.ts` |
| Turn the map | Tap or drag the compass rose (top left) | Tap: north, east, south, west step to the top of the screen. Drag: the map turns with the finger, around the tip when it is in view. Using the compass switches auto-rotate off; the Auto pill (or Settings) turns it back on | Auto-rotate on means every glide re-aims the road ahead upward | Compass card turns with the map, N in red; Auto pill purple when on; one-time tip when auto-rotate switches off | `scripts/compasstest.ts` |
| Close the loop | Cross the start line after a full lap | Line validated, lap simulated, race starts | Lateral gap between start and finish costs time | Start marker appears after 70%, `Lap drawn` stamp | Playtests |
| Watch the lap | None (Skip available) | Real-time playback of the simulated lap | Tyre temperature, wind, downforce, line quality | Timer, live delta to best, sector colours, speed, gear, LEDs, DRS, tyre temp, engine sound, finish card | Playtest frames 5 to 6c |
| Read the result | None, then `Draw again` | Grid slot or pace ladder, PB saved, leaderboard post | Pole means beating real pole pace | Camera pulls back to a speed trace, stamp, sectors, engineer's notes, confetti on PB | Playtest frame 7 |

## Smallest useful test

Largest risk: drawing a precise line on a phone. Tested by drawing complete laps with real touch events at 390x844.

## First action and recovery

First action is visible on arrival: pulsing chequered band, chevrons and an animated fingertip. Going over the limit stops the stroke with a clear marker and a one-tap undo of just that stroke. Muted audio loses nothing essential; every cue has a visual twin.

## Done when

A full lap can be drawn with touch input, a track-limits violation is legible and undone in one tap, and the race and results present the same time the server records. Evidence: `scripts/touchtest.ts`, `scripts/playtest.ts`, `tests/`.
Remaining human judgment: stroke length in pause mode (about 140 m of track per stroke on a phone, so 30 to 40 strokes a lap), continuous-mode speed defaults, and whether the difficulty ladder feels fair.
