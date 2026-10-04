// Results: the lap as a speed-coloured trace over the whole circuit, and a
// classification sheet with the grid slot, sectors, engineer's notes and the
// world leaderboard.

import type { App, Screen } from '../app/app';
import { fetchBoard, submitLap } from '../app/api';
import { sfx } from '../app/audio';
import { engineerNotes } from '../app/engineer';
import { formatDelta, formatLap, formatSector, gridSlot, kmh } from '../app/format';
import { getPlayer, markSubmitted, setPlayerName, type PersonalBest } from '../app/store';
import { Camera } from '../render/camera';
import { speedPaths } from '../render/line-art';
import type { TrackArt } from '../render/track-art';
import { COMPOUND_SPECS } from '../sim/car';
import type { LapResult } from '../sim/lapsim';
import { frameAt, type Track } from '../sim/track';
import { h, setText, tyreBadge } from '../ui/dom';
import { sectorColour } from './race';

export interface ResultsActions {
  again(): void;
  leaderboard(): void;
  home(): void;
}

export interface ResultsInput {
  lap: LapResult;
  points: Float64Array;
  code: number[];
  previous: PersonalBest | null;
  bestSectorsBefore: [number, number, number] | null;
  isPb: boolean;
  attempt: number;
}

const NAME_RE = /^[A-Za-z0-9 _.-]{2,14}$/;

export class ResultsScreen implements Screen {
  private cam = new Camera();
  private heat: { color: string; path: Path2D }[];
  private el: HTMLElement;
  private sheet: HTMLElement;
  private world: HTMLElement;
  private opened = performance.now();
  private bounds: { minX: number; minY: number; maxX: number; maxY: number };

  constructor(
    private app: App,
    private track: Track,
    private art: TrackArt,
    private input: ResultsInput,
    private actions: ResultsActions,
  ) {
    app.setCanvasVisible(true);
    const { lap } = input;
    this.heat = speedPaths(lap.x, lap.y, lap.v);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < track.n; i++) {
      minX = Math.min(minX, track.x[i]); maxX = Math.max(maxX, track.x[i]);
      minY = Math.min(minY, track.y[i]); maxY = Math.max(maxY, track.y[i]);
    }
    this.bounds = { minX, minY, maxX, maxY };

    const meta = track.meta;
    const slot = gridSlot(lap.timeMs, meta.poleRef);
    const prev = input.previous;
    const deltaText = !prev ? 'First timed lap here' : input.isPb ? `New personal best, ${formatDelta(lap.timeMs - prev.timeMs)}` : `${formatDelta(lap.timeMs - prev.timeMs)} to your best ${formatLap(prev.timeMs)}`;

    const sectors = h('ol', { class: 'res-sectors' });
    lap.sectorsMs.forEach((ms, k) => {
      const colour = sectorColour(ms, k, track, input.bestSectorsBefore);
      sectors.append(h('li', { 'data-c': colour }, h('span', null, `Sector ${k + 1}`), h('b', null, formatSector(ms))));
    });

    const spec = COMPOUND_SPECS[lap.compound];
    const facts = h(
      'dl',
      { class: 'res-facts' },
      h('div', null, h('dt', null, 'Top speed'), h('dd', null, `${kmh(lap.stats.topSpeed)} km/h`)),
      h('div', null, h('dt', null, 'Slowest corner'), h('dd', null, `${kmh(lap.stats.minSpeed)} km/h`)),
      h('div', null, h('dt', null, 'Peak lateral'), h('dd', null, `${lap.stats.maxLatG.toFixed(1)} g`)),
      h('div', null, h('dt', null, 'Tyre temp'), h('dd', { html: `${tyreBadge(lap.compound, 16)} ${Math.round(lap.stats.tyreMax)}°C` })),
    );
    void spec;

    const notes = engineerNotes(track, lap, input.points);
    this.world = h('div', { class: 'res-world' });

    const slotText = slot.position ? `P${slot.position}` : '107%';
    this.sheet = h(
      'section',
      { class: `sheet res-sheet tier-${slot.tier}`, 'aria-labelledby': 'res-time' },
      h('p', { class: 'res-kicker' }, `${meta.short} qualifying, attempt ${input.attempt}`),
      h(
        'div',
        { class: 'res-headline' },
        h('h2', { id: 'res-time', class: 'res-time' }, formatLap(lap.timeMs)),
        h('div', { class: 'res-slot', 'aria-label': `Grid slot ${slotText}` }, h('b', null, slotText), h('span', null, slot.label)),
      ),
      h('p', { class: `res-delta${input.isPb ? ' is-pb' : ''}` }, deltaText),
      sectors,
      facts,
      h('div', { class: 'res-notes' }, ...notes.map((n) => h('p', null, n))),
      this.world,
      h(
        'div',
        { class: 'res-actions' },
        h('button', { class: 'btn-primary', onclick: () => this.actions.again() }, 'Draw again'),
        h('div', { class: 'res-secondary' }, h('button', { class: 'btn-quiet', onclick: () => this.actions.leaderboard() }, 'Leaderboard'), h('button', { class: 'btn-quiet', onclick: () => this.actions.home() }, 'Circuits')),
      ),
    );
    this.el = h('div', { class: 'results' }, this.sheet);
    app.root.append(this.el);
    this.resize();
    if (input.isPb) sfx.finish(true);
    this.leaderboardBlock();
  }

  private leaderboardBlock(): void {
    const { lap, isPb, code } = this.input;
    const player = getPlayer();
    const slug = this.track.meta.slug;
    const status = h('p', { class: 'res-world-status' }, '');
    this.world.append(status);
    const post = (name: string) => {
      setText(status, 'Posting to the world leaderboard…');
      submitLap({ track: slug, compound: lap.compound, line: code, playerId: player.id, name })
        .then((r) => {
          markSubmitted(slug);
          if (r.timeMs !== lap.timeMs) console.warn('server time differs', r.timeMs, lap.timeMs);
          setText(status, r.rank ? `World #${r.rank} of ${r.total} on ${this.track.meta.short}` : 'Posted.');
          status.classList.add('is-rank');
        })
        .catch((err: Error) => setText(status, `Not posted: ${err.message}. Your time is saved on this device.`));
    };
    if (!isPb) {
      fetchBoard(slug, player.id, 1)
        .then((b) => setText(status, b.you ? `Your best is world #${b.you.rank} of ${b.total}` : b.total ? `${b.total} drivers have set times here` : ''))
        .catch(() => setText(status, ''));
      return;
    }
    if (player.name) {
      post(player.name);
      return;
    }
    const input = h('input', { class: 'name-input', type: 'text', maxlength: '14', autocomplete: 'nickname', placeholder: 'Your name', 'aria-label': 'Your name for the leaderboard', enterkeyhint: 'send' }) as HTMLInputElement;
    const btn = h('button', { class: 'btn-ink', type: 'submit' }, 'Post time');
    const form = h(
      'form',
      {
        class: 'name-form',
        onsubmit: (e: Event) => {
          e.preventDefault();
          const name = input.value.trim().replace(/\s+/g, ' ');
          if (!NAME_RE.test(name)) {
            setText(status, 'Use 2 to 14 letters or numbers.');
            input.focus();
            return;
          }
          setPlayerName(name);
          form.remove();
          post(name);
        },
      },
      input,
      btn,
    );
    setText(status, 'Post this lap to the world leaderboard.');
    this.world.append(form);
  }

  resize(): void {
    this.cam.w = this.app.w;
    this.cam.h = this.app.h;
    const sheetH = Math.min(this.app.h * 0.66, this.sheet?.offsetHeight || this.app.h * 0.6);
    const visibleH = Math.max(160, this.app.h - sheetH - 16);
    const b = this.bounds;
    const pad = 28;
    const zx = (this.app.w - pad * 2) / (b.maxX - b.minX);
    const zy = (visibleH - pad * 2) / (b.maxY - b.minY);
    this.cam.zoom = Math.min(zx, zy);
    this.cam.angle = 0;
    this.cam.cx = (b.minX + b.maxX) / 2;
    this.cam.cy = (b.minY + b.maxY) / 2;
    this.cam.ax = 0.5;
    this.cam.ay = visibleH / 2 / this.app.h;
  }

  frame(now: number): void {
    const { ctx } = this.app;
    const dpr = this.app.dpr;
    this.cam.apply(ctx, dpr);
    this.art.draw(ctx, this.cam);
    const z = this.cam.zoom;
    const t = Math.min(1, (now - this.opened) / 900);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 6.5 / z;
    for (const p of this.heat) ctx.stroke(p.path);
    ctx.globalAlpha = t;
    ctx.lineWidth = 4 / z;
    for (const p of this.heat) {
      ctx.strokeStyle = p.color;
      ctx.stroke(p.path);
    }
    ctx.restore();
    // Sector boundaries.
    for (const f of [1 / 3, 2 / 3]) {
      const fr = frameAt(this.track, this.track.length * f);
      const s = this.track.limit + 8;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2 / z;
      ctx.beginPath();
      ctx.moveTo(fr.x + fr.nx * s, fr.y + fr.ny * s);
      ctx.lineTo(fr.x - fr.nx * s, fr.y - fr.ny * s);
      ctx.stroke();
    }
  }

  destroy(): void {
    this.el.remove();
  }
}
