// Compact text form of a line's delta code (see encodePath) for storage and
// transfer: zigzag varints, then base64. A 5,000-point lap packs into about
// 14 KB, half its JSON size. Runs in the browser and the leaderboard function.

export function packLine(code: readonly number[]): string {
  let bin = '';
  for (const v of code) {
    let z = v >= 0 ? v * 2 : -v * 2 - 1;
    while (z >= 0x80) {
      bin += String.fromCharCode((z % 0x80) | 0x80);
      z = Math.floor(z / 0x80);
    }
    bin += String.fromCharCode(z);
  }
  return btoa(bin);
}

export function unpackLine(packed: string): number[] {
  const bin = atob(packed);
  const out: number[] = [];
  let z = 0;
  let scale = 1;
  for (let i = 0; i < bin.length; i++) {
    const b = bin.charCodeAt(i);
    z += (b & 0x7f) * scale;
    if (b & 0x80) {
      scale *= 0x80;
      continue;
    }
    out.push(z % 2 === 0 ? z / 2 : -(z + 1) / 2);
    z = 0;
    scale = 1;
  }
  return out;
}
