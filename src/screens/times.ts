// Your times: the player's quickest laps on a circuit as a bottom sheet, each
// one watchable again and its drawing setup one tap from being reused. The
// Toybox edition shows this where the web edition shows the world leaderboard.

import type { App } from '../app/app';
import { sfx } from '../app/audio';
import { CORNER_DAMPING_OPTIONS } from '../app/damping';
import { formatDelta, formatLap, gridSlot } from '../app/format';
import { getLaps, LAPS_KEPT, whenText, type SavedLap } from '../app/laps';
import { applySetup, currentSetup, getTyre, sameSetup, setTyre, type DrawSetup } from '../app/store';
import { COMPOUND_SPECS } from '../sim/car';
import type { Compound } from '../sim/types';
import { ICONS, h, tyreBadge } from '../ui/dom';

export interface TimesOptions {
  /** Runs after the player reuses a lap's setup. */
  copied?: () => void;
  /** Start watching the lap at this index (0 is the quickest); rejects when it cannot be replayed. */
  watch?: (index: number) => Promise<void>;
}

export function openTimes(app: App, slug: string, opts: TimesOptions = {}): void {
  const meta = app.meta(slug);
  const laps = getLaps(slug);
  const list = h('ol', { class: 'board' });
  const close = () => {
    overlay.classList.add('is-closing');
    setTimeout(() => overlay.remove(), 200);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  const closeBtn = h('button', { class: 'icon-btn', 'aria-label': 'Close your times', html: ICONS.close, onclick: close });
  const pole = `Pole pace ${formatLap(meta.poleRef * 1000)}`;
  const sub = laps.length ? `${pole} · ${laps.length} ${laps.length === 1 ? 'lap' : 'laps'}` : pole;
  const head = h('header', { class: 'board-head' }, h('div', null, h('h2', { id: 'board-title' }, `${meta.short}, your times`), h('p', null, sub)), closeBtn);
  const sheet = h(
    'section',
    { class: 'sheet board-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'board-title' },
    head,
    list,
    h('p', { class: 'board-keep' }, `Your ${LAPS_KEPT} quickest laps here stay on this device.`),
  );
  const overlay = h('div', { class: 'overlay', onclick: (e: Event) => e.target === overlay && close() }, sheet);
  app.root.append(overlay);
  document.addEventListener('keydown', onKey);
  closeBtn.focus({ focusVisible: false } as FocusOptions);

  if (!laps.length) {
    list.append(h('li', { class: 'board-status' }, 'No lap yet. Draw one and it lands here.'));
    return;
  }
  const watch = opts.watch
    ? (index: number) =>
        opts.watch!(index).then(() => {
          // The replay is on screen: get the sheet out of its way.
          overlay.remove();
          document.removeEventListener('keydown', onKey);
        })
    : undefined;
  laps.forEach((lap, i) => list.append(lapRow(lap, i, laps[0].timeMs, meta.poleRef, slug, { copied: opts.copied, watch })));
}

/** How a lap was drawn, in the settings' own words. */
function setupText(setup: DrawSetup, compound: Compound): string {
  const parts: string[] = [];
  if (setup.scrollMode === 'pause') {
    parts.push('Pause my stroke');
  } else {
    parts.push(`Keep drawing at ${setup.scrollSpeed.toFixed(2)}×`);
    const damping = CORNER_DAMPING_OPTIONS.find((o) => o.id === setup.cornerDamping);
    parts.push(setup.cornerDamping === 'off' || !damping ? 'no corner slowdown' : damping.label.toLowerCase());
  }
  parts.push(setup.autoRotate ? 'map rotates' : 'map fixed');
  parts.push(`${COMPOUND_SPECS[compound].label.toLowerCase()}s`);
  return parts.join(', ');
}

let rowIds = 0;

/** One lap. A play button watches it; the row opens to show the setup it was drawn with. */
function lapRow(lap: SavedLap, index: number, best: number, poleRef: number, slug: string, opts: TimesOptions): HTMLElement {
  const li = h('li', { class: `board-entry${index === 0 ? ' is-you' : ''}` });
  const status = h('p', { class: 'board-note', role: 'status', hidden: true });
  const slot = gridSlot(lap.timeMs, poleRef);
  const name = h('span', { class: 'board-name' }, h('span', { class: 'board-name-text' }, whenText(lap.date)), h('span', { class: `board-slot slot tier-${slot.tier}` }, slot.stamp));
  const time = h('span', { class: 'board-time' }, h('b', null, formatLap(lap.timeMs)), h('small', null, index === 0 ? '' : formatDelta(lap.timeMs - best)));
  const cells = [h('span', { class: 'board-rank' }, String(index + 1)), name, h('span', { class: 'board-tyre', html: tyreBadge(lap.compound, 18) }), time];

  let play: HTMLElement | null = null;
  if (opts.watch) {
    const btn = h('button', {
      class: 'board-play',
      'aria-label': index === 0 ? 'Watch your quickest lap' : 'Watch this lap against your quickest',
      title: index === 0 ? 'Watch lap' : 'Watch against your best',
      html: ICONS.play,
    }) as HTMLButtonElement;
    btn.onclick = (ev: Event) => {
      ev.stopPropagation();
      sfx.tap();
      btn.disabled = true;
      btn.classList.add('is-loading');
      opts.watch!(index).catch(() => {
        btn.disabled = false;
        btn.classList.remove('is-loading');
        status.textContent = 'That lap can’t be replayed right now.';
        status.classList.add('is-error');
        status.hidden = false;
      });
    };
    play = btn;
  }

  const setup = lap.setup;
  if (!setup) {
    li.append(h('div', { class: 'board-row' }, ...cells, play ?? h('span', { class: 'board-play-gap' })), status);
    return li;
  }
  const id = `times-setup-${++rowIds}`;
  const copy = h('button', { class: 'board-copy' }, 'Use setup') as HTMLButtonElement;
  const sync = () => {
    const same = sameSetup(currentSetup(), setup) && getTyre(slug) === lap.compound;
    copy.disabled = same;
    copy.textContent = same ? 'In use' : 'Use setup';
  };
  copy.onclick = () => {
    applySetup(setup);
    setTyre(slug, lap.compound);
    sfx.tap();
    copy.disabled = true;
    copy.textContent = 'In use';
    opts.copied?.();
  };
  const detail = h('div', { class: 'board-setup', id, hidden: true }, h('p', null, setupText(setup, lap.compound)), copy);
  name.append(h('span', { class: 'board-chevron', 'aria-hidden': 'true', html: ICONS.chevron }));
  const toggle = h('button', { class: 'board-open', 'aria-expanded': 'false', 'aria-controls': id, 'aria-label': 'How this lap was drawn' });
  const row = h('div', { class: 'board-row is-openable' }, ...cells, play ?? h('span', { class: 'board-play-gap' }));
  row.prepend(toggle);
  toggle.onclick = () => {
    const open = detail.hidden !== false;
    detail.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    li.classList.toggle('is-open', open);
    if (open) sync();
  };
  li.append(row, detail, status);
  return li;
}
