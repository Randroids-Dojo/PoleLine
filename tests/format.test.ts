import { describe, expect, it } from 'vitest';
import { averageGrid, gridSlot } from '../src/app/format';

// A lap the given percentage off a 100 s pole.
const at = (gapPct: number) => gridSlot(Math.round(100000 * (1 + gapPct / 100)), 100);

describe('average grid', () => {
  it('is empty before the first lap', () => {
    expect(averageGrid([])).toBeNull();
  });

  it('is the slot itself for a single circuit', () => {
    expect(gridSlot(113984, 92.51).stamp).toBe('F3 P26');
    expect(averageGrid([gridSlot(113984, 92.51)])).toEqual({ stamp: 'F3 P26', tier: 'f3' });
    expect(averageGrid([at(-0.1)])).toEqual({ stamp: 'P1', tier: 'pole' });
    expect(averageGrid([at(4)])).toEqual({ stamp: '107%', tier: 'f1' });
    expect(averageGrid([at(40)])).toEqual({ stamp: 'Club P22', tier: 'club' });
    // Far off the pace shares the back of the club grid.
    expect(averageGrid([gridSlot(173976, 101.117)])).toEqual({ stamp: 'Club P40', tier: 'club' });
  });

  it('averages F1 positions to one decimal', () => {
    // P1 and P4.
    expect(at(0.18).stamp).toBe('P4');
    expect(averageGrid([at(-0.1), at(0.18)])).toEqual({ stamp: 'P2.5', tier: 'q3' });
    // Pole only stays purple when every circuit is a pole.
    expect(averageGrid([at(-0.1), at(-0.2)])?.tier).toBe('pole');
  });

  it('averages across series on one ladder', () => {
    // Pole (rung 1) and F3 P26 (rung 69) meet in the middle of the F2 grid.
    expect(averageGrid([at(-0.1), gridSlot(113984, 92.51)])).toEqual({ stamp: 'F2 P14', tier: 'f2' });
    // F3 P26 (rung 69) and club P40 (rung 113) average into the club grid.
    expect(averageGrid([gridSlot(113984, 92.51), gridSlot(173976, 101.117)])).toEqual({ stamp: 'Club P18', tier: 'club' });
  });
});
