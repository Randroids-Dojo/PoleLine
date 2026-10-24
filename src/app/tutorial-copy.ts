// What the tutorial says about drawing, for each way of drawing. The guided
// first lap, its corner coaching, the race caption and the results line all
// read from here, so the words always match the mode the player has chosen
// (and change with it when they switch mid-tutorial).

import type { DrawMode } from './draw-mode';

export interface TutorialCopy {
  /** The walkthrough's "Your turn" card. */
  turn: string;
  /** The hint at the purple tip when the tutorial lap opens without the walkthrough, or starts again. */
  start: string;
  /** The hint once the player has started on the last corner. */
  going: string;
  /** Coaching as the line reaches each stage of the last corner: approach, turn in, apex, exit. */
  tips: [string, string, string, string];
  /** The race caption as the car reaches the player's corner. */
  yourCorner: string;
  /** The first sentence of the results after the walkthrough lap. */
  wholeGame: string;
}

export const TUTORIAL_COPY: Record<DrawMode, TutorialCopy> = {
  curves: {
    turn: 'Tap the track ahead of the purple tip to lay a curve, drag its middle dot to bend it, and carry on to the chequered line. The dotted line is one fast way round.',
    start: 'Tap the track ahead of the purple tip, through the last corner to the finish line.',
    going: 'Drag the middle dot to bend it. Tap further on to carry on.',
    tips: [
      'Lay your next curve out wide as the corner comes up.',
      'Now tap near the inside kerb to turn in.',
      'Tap right against the inside at the apex. Bend a curve if it misses.',
      'Tap out wide on the exit, then on the chequered line.',
    ],
    yourCorner: 'Now the corner you laid out.',
    wholeGame: 'That is the whole game: tap out a line, watch it run, find time.',
  },
  smooth: {
    turn: 'Put your finger on the purple tip and draw through the last corner to the chequered line. When you lift, your stroke is corrected into a racing line. The dotted line is one fast way round.',
    start: 'Put your finger on the purple tip and draw to the finish line. Each stroke is corrected when you lift.',
    going: 'Draw through the corner. When you lift, your stroke is corrected.',
    tips: [
      'Stay out wide as the corner comes up.',
      'Now turn in, aiming for the inside kerb.',
      'Clip the apex. Near enough is fine: the stroke is corrected when you lift.',
      'Let it run out wide, then straight to the line.',
    ],
    yourCorner: 'Now the corner you drew.',
    wholeGame: 'That is the whole game: draw a line, watch it run, find time.',
  },
  freehand: {
    turn: 'Put your finger on the purple tip and draw through the last corner to the chequered line. The dotted line is one fast way round.',
    start: 'Put your finger on the purple tip and draw to the finish line.',
    going: 'Stay inside the white lines.',
    tips: [
      'Stay out wide as the corner comes up.',
      'Now turn in, aiming for the inside kerb.',
      'Clip the apex, right against the inside.',
      'Let it run out wide, then straight to the line.',
    ],
    yourCorner: 'Now the corner you drew.',
    wholeGame: 'That is the whole game: draw a line, watch it run, find time.',
  },
};
