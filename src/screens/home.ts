// Home: pick a round, read the locked conditions, choose a tyre, go draw.

import type { App, Screen } from '../app/app';
import { fetchRecords, type Records } from '../app/api';
import { sfx, unlockAudio } from '../app/audio';
import { openSettings } from './settings';
import { openConditions } from './conditions';
import { outlinePath, outlineViewBox } from '../app/describe';
import { averageGrid, formatLap, gridSlot, type GridSlot } from '../app/format';
import { getBest, getSettings, getTyre, saveSettings } from '../app/store';
import { CATALOG } from '../data/catalog';
import type { Compound, TrackMeta } from '../sim/types';
import { ICONS, clear, h, svg } from '../ui/dom';

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
    clear(this.event);

    const map = svg(`<svg class="hero-map" viewBox="${outlineViewBox(m)}" role="img" aria-label="${m.name} layout">
      <path class="hero-track" d="${outlinePath(m)}"/>
      <path class="hero-ink" pathLength="1" d="${outlinePath(m)}"/>
      <circle class="hero-start" cx="${m.outline[0]}" cy="${m.outline[1]}" r="18"/>
    </svg>`);

    // One row of times; the whole row opens the leaderboard.
    const slot = pb ? gridSlot(pb.timeMs, m.poleRef) : null;
    const stat = (label: string, value: string, extra: Node | null, sub: string | null, empty = false) =>
      h(
        'span',
        { class: `stat${empty ? ' is-empty' : ''}` },
        h('span', { class: 'stat-label' }, label, extra),
        h('span', { class: 'stat-value' }, value),
        sub ? h('span', { class: 'stat-sub' }, sub) : null,
      );
    const times = h(
      'button',
      { class: 'times-block', 'aria-label': `Lap times. Open the ${m.short} leaderboard`, onclick: () => this.actions.leaderboard(m.slug) },
      h(
        'span',
        { class: 'times' },
        stat('Pole', formatLap(m.poleRef * 1000), null, null),
        stat('Your best', pb ? formatLap(pb.timeMs) : 'No lap yet', slot ? h('span', { class: `slot tier-${slot.tier}` }, slot.stamp) : null, null, !pb),
        stat('Record', rec ? formatLap(rec.timeMs) : 'Open', null, rec ? rec.name : null, !rec),
      ),
      h('span', { class: 'times-go', html: ICONS.chevronRight }),
    );

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

    this.event.append(
      h(
        'div',
        { class: 'event-title' },
        h(
          'p',
          { class: 'event-round' },
          `Round ${round} of ${CATALOG.length}`,
          h('span', { class: 'flag' }, m.flag),
          m.country,
          h('button', { class: 'event-info', onclick: () => openConditions(this.app, m) }, 'Conditions'),
        ),
        h('h2', null, m.short),
      ),
      map,
      times,
      h('div', { class: 'launch' }, go),
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


export type { TrackMeta };
