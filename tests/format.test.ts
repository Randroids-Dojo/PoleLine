import { describe, expect, it } from 'vitest';
import { averageGrid, gridSlot } from '../src/app/format';

// A lap the given percentage off a 100 s pole.
const at = (gapPct: number) => gridSlot(Math.round(100000 * (1 + gapPct / 100)), 100);

describe('grid slot', () => {
  it('places laps on the F1 grid', () => {
    expect(at(-0.1)).toMatchObject({ stamp: 'P1', tier: 'pole' });
    expect(at(0.18)).toMatchObject({ stamp: 'P4', tier: 'q3' });
    expect(at(1.0)).toMatchObject({ stamp: 'P14', tier: 'q2' });
    expect(at(1.85)).toMatchObject({ stamp: 'P20', tier: 'q1' });
  });

  it('lines up anything slower than P20 pace at P20', () => {
    expect(at(4).stamp).toBe('P20');
    expect(gridSlot(113984, 92.51).stamp).toBe('P20');
    expect(gridSlot(173976, 101.117).stamp).toBe('P20');
  });
});

describe('average grid', () => {
  it('is empty before the first lap', () => {
    expect(averageGrid([])).toBeNull();
  });

  it('is the slot itself for a single circuit', () => {
    expect(averageGrid([gridSlot(113984, 92.51)])).toEqual({ stamp: 'P20', tier: 'q1' });
    expect(averageGrid([at(-0.1)])).toEqual({ stamp: 'P1', tier: 'pole' });
  });

  it('averages positions to one decimal', () => {
    expect(averageGrid([at(-0.1), at(0.18)])).toEqual({ stamp: 'P2.5', tier: 'q3' });
    expect(averageGrid([at(-0.1), at(40)])).toEqual({ stamp: 'P10.5', tier: 'q2' });
    expect(averageGrid([at(-0.1), at(0.18), at(40)])).toEqual({ stamp: 'P8.3', tier: 'q3' });
    // Pole only stays purple when every circuit is a pole.
    expect(averageGrid([at(-0.1), at(-0.2)])?.tier).toBe('pole');
    const nearlyAllPoles = [...Array(10)].map(() => at(-0.1)).concat(at(0.03));
    expect(averageGrid(nearlyAllPoles)).toEqual({ stamp: 'P1.1', tier: 'q3' });
  });
});
