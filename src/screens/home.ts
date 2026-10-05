// Home: pick a round, read the locked conditions, choose a tyre, go draw.

import type { App, Screen } from '../app/app';
import { fetchRecords, type Records } from '../app/api';
import { sfx, unlockAudio } from '../app/audio';
import { openSettings } from './settings';
import { openGarage } from './garage';
import { liveryPreview } from '../render/car-art';
import { liveryById } from '../render/liveries';
import { downforceLabel, gripLabel, outlinePath, outlineViewBox, tyreHint, windText } from '../app/describe';
import { averageGrid, formatLap, gridSlot, type GridSlot } from '../app/format';
import { getBest, getSettings, getTyre, saveSettings, setTyre } from '../app/store';
import { CATALOG } from '../data/catalog';
import { COMPOUND_SPECS } from '../sim/car';
import { COMPOUNDS, type Compound, type TrackMeta } from '../sim/types';
import { ICONS, clear, h, svg, tyreBadge } from '../ui/dom';

export interface HomeActions {
  draw(slug: string, compound: Compound): void;
  leaderboard(slug: string): void;
}

export class HomeScreen implements Screen {
  private el: HTMLElement;
  private slug: string;
  private event!: HTMLElement;
  private strip!: HTMLElement;
  private records: Records = {};

  constructor(private app: App, private actions: HomeActions, slug?: string) {
    const settings = getSettings();
    this.slug = slug ?? settings.lastTrack ?? 'spielberg';
    if (!CATALOG.some((m) => m.slug === this.slug)) this.slug = 'spielberg';
    app.setCanvasVisible(false);
    this.el = h('main', { class: 'home' });
    this.render();
    app.root.append(this.el);
    fetchRecords()
      .then((r) => {
        this.records = r;
        this.renderEvent();
      })
      .catch(() => {});
  }

  private render(): void {
    const gearBtn = h('button', { class: 'icon-btn', 'aria-label': 'Settings', html: ICONS.gear, onclick: () => openSettings(this.app) });
    const header = h('header', { class: 'home-head' }, h('h1', { class: 'wordmark' }, 'PoleLine'), h('div', { class: 'head-right' }, averageStat(), gearBtn));
    this.strip = h('nav', { class: 'rounds', 'aria-label': 'Circuits' });
    CATALOG.forEach((m, i) => {
      const pb = getBest(m.slug);
      const btn = h(
        'button',
        { class: `round${m.slug === this.slug ? ' is-on' : ''}`, 'data-slug': m.slug, 'aria-label': `Round ${i + 1}, ${m.short}`, onclick: () => this.select(m.slug) },
        h('span', { class: 'round-top' }, h('span', { class: 'round-n' }, `R${i + 1}`), pb ? badge(gridSlot(pb.timeMs, m.poleRef)) : null),
        svg(`<svg class="round-map" viewBox="${outlineViewBox(m, 90)}" aria-hidden="true"><path d="${outlinePath(m)}"/></svg>`),
        h('span', { class: 'round-name' }, m.short),
      );
      this.strip.append(btn);
    });
    this.event = h('section', { class: 'event' });
    this.el.append(header, this.strip, this.event);
    this.renderEvent();
    requestAnimationFrame(() => this.scrollStripTo(this.slug, false));
  }

  private scrollStripTo(slug: string, smooth: boolean): void {
    const btn = this.strip.querySelector<HTMLElement>(`[data-slug="${slug}"]`);
    if (!btn) return;
    const left = btn.offsetLeft - (this.strip.clientWidth - btn.clientWidth) / 2;
    this.strip.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
  }

  private select(slug: string): void {
    if (slug === this.slug) return;
    sfx.tap();
    this.slug = slug;
    saveSettings({ lastTrack: slug });
    this.strip.querySelectorAll('.round').forEach((b) => b.classList.toggle('is-on', (b as HTMLElement).dataset.slug === slug));
    this.scrollStripTo(slug, true);
    this.renderEvent();
  }

  /** Redraw the selected circuit (after a copied setup changed its tyre). */
  refresh(): void {
    this.renderEvent();
  }

  private renderEvent(): void {
    const m = CATALOG.find((x) => x.slug === this.slug)!;
    const round = this.app.round(m.slug);
    const pb = getBest(m.slug);
    const rec = this.records[m.slug];
    const tyre = getTyre(m.slug);
    clear(this.event);

    const map = svg(`<svg class="hero-map" viewBox="${outlineViewBox(m)}" role="img" aria-label="${m.name} layout">
      <path class="hero-track" d="${outlinePath(m)}"/>
      <path class="hero-ink" pathLength="1" d="${outlinePath(m)}"/>
      <circle class="hero-start" cx="${m.outline[0]}" cy="${m.outline[1]}" r="18"/>
    </svg>`);

    const slot = pb ? gridSlot(pb.timeMs, m.poleRef) : null;
    const times = h(
      'dl',
      { class: 'times' },
      h('div', null, h('dt', null, 'Pole pace'), h('dd', null, formatLap(m.poleRef * 1000))),
      h(
        'div',
        { class: pb ? '' : 'is-empty' },
        h('dt', null, 'Your best'),
        h('dd', null, pb ? formatLap(pb.timeMs) : 'No lap yet', slot ? h('span', { class: `slot tier-${slot.tier}` }, slot.stamp) : null),
      ),
      h('div', null, h('dt', null, 'World record'), h('dd', null, rec ? formatLap(rec.timeMs) : 'Open', rec ? h('span', { class: 'holder' }, rec.name) : null)),
    );

    const facts = h(
      'dl',
      { class: 'facts' },
      fact('Air', `${m.airTemp}°C`),
      fact('Track', `${m.trackTemp}°C`),
      fact('Wind', windText(m), h('span', { class: 'wind-arrow', style: `transform: rotate(${m.windFrom + 180}deg)`, 'aria-hidden': 'true' }, '↑')),
      fact('Straight mode', `${m.straights.length} ${m.straights.length === 1 ? 'zone' : 'zones'}`),
      fact('Downforce', downforceLabel(m)),
      fact('Grip', gripLabel(m)),
      fact('Length', `${(m.length / 1000).toFixed(3)} km`),
      fact('Turns', String(m.turns)),
    );

    const tyres = h('div', { class: 'tyres', role: 'radiogroup', 'aria-label': 'Tyre compound' });
    const hint = h('p', { class: 'tyre-hint' }, tyreHint(m));
    for (const c of COMPOUNDS) {
      const b = h(
        'button',
        {
          class: `tyre${c === tyre ? ' is-on' : ''}`,
          role: 'radio',
          'aria-checked': c === tyre ? 'true' : 'false',
          onclick: () => {
            sfx.tap();
            setTyre(m.slug, c);
            tyres.querySelectorAll('.tyre').forEach((el) => {
              const on = (el as HTMLElement).dataset.c === c;
              el.classList.toggle('is-on', on);
              el.setAttribute('aria-checked', on ? 'true' : 'false');
            });
          },
          'data-c': c,
          html: `${tyreBadge(c, 30)}<span>${COMPOUND_SPECS[c].label}</span>`,
        },
      );
      tyres.append(b);
    }

    const go = h(
      'button',
      {
        class: 'btn-primary',
        onclick: () => {
          unlockAudio();
          sfx.tap();
          this.actions.draw(m.slug, getTyre(m.slug));
        },
      },
      'Draw a lap',
    );
    const board = h('button', { class: 'btn-quiet', onclick: () => this.actions.leaderboard(m.slug), html: `${ICONS.board}<span>Leaderboard</span>` });

    const livery = liveryById(getSettings().livery);
    const car = h(
      'button',
      { class: 'car-btn', 'aria-label': `Your car: ${livery.name}. Change livery`, title: `Your car: ${livery.name}`, onclick: () => openGarage(this.app, () => this.renderEvent()) },
      h('img', { src: liveryPreview(livery, 'up'), alt: '' }),
    );

    this.event.append(
      h('div', { class: 'event-title' }, h('p', { class: 'event-round' }, `Round ${round} of ${CATALOG.length}`, h('span', { class: 'flag' }, m.flag), m.country), h('h2', null, m.short), h('p', { class: 'event-name' }, m.name)),
      map,
      times,
      board,
      facts,
      hint,
      h('div', { class: 'launch' }, tyres, h('div', { class: 'launch-go' }, car, go)),
    );
  }

  destroy(): void {
    this.el.remove();
  }
}

function badge(slot: GridSlot): HTMLElement {
  return h('span', { class: `round-pb tier-${slot.tier}` }, slot.stamp);
}

/** Average of the best grid slot on every circuit with a lap; hidden until the first lap. */
function averageStat(): HTMLElement | null {
  const slots: GridSlot[] = [];
  for (const m of CATALOG) {
    const pb = getBest(m.slug);
    if (pb) slots.push(gridSlot(pb.timeMs, m.poleRef));
  }
  const avg = averageGrid(slots);
  if (!avg) return null;
  const across = `${slots.length} ${slots.length === 1 ? 'circuit' : 'circuits'}`;
  return h(
    'span',
    { class: 'avg-grid', title: `Average of your best grid slot on ${across}`, 'aria-label': `Average grid ${avg.stamp} across ${across}` },
    h('span', { class: 'avg-grid-label' }, 'Avg grid'),
    h('span', { class: `slot tier-${avg.tier}` }, avg.stamp),
  );
}

function fact(label: string, value: string, extra?: Node): HTMLElement {
  return h('div', null, h('dt', null, label), h('dd', null, value, extra ?? null));
}

export type { TrackMeta };
