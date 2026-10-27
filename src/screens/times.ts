// Your times: the player's quickest laps on a circuit as a bottom sheet, each
// one watchable again and its drawing setup one tap from being reused. The
// Toybox edition shows this where the web edition shows the world leaderboard.
// The same laps make the list a saved line is picked from to edit, in both
// editions.

import type { App } from '../app/app';
import { sfx } from '../app/audio';
import { CORNER_DAMPING_OPTIONS } from '../app/damping';
import { drawModeText } from '../app/draw-mode';
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

/** A bottom sheet of laps that closes on its button, a tap outside it or Escape. `remove` takes it away at once. */
function lapSheet(app: App, title: string, sub: string, closeLabel: string, foot: string): { list: HTMLElement; remove(): void } {
  const list = h('ol', { class: 'board' });
  const remove = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const close = () => {
    overlay.classList.add('is-closing');
    setTimeout(() => overlay.remove(), 200);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  const closeBtn = h('button', { class: 'icon-btn', 'aria-label': closeLabel, html: ICONS.close, onclick: close });
  const head = h('header', { class: 'board-head' }, h('div', null, h('h2', { id: 'board-title' }, title), h('p', null, sub)), closeBtn);
  const sheet = h('section', { class: 'sheet board-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'board-title' }, head, list, h('p', { class: 'board-keep' }, foot));
  const overlay = h('div', { class: 'overlay', onclick: (e: Event) => e.target === overlay && close() }, sheet);
  app.root.append(overlay);
  document.addEventListener('keydown', onKey);
  closeBtn.focus({ focusVisible: false } as FocusOptions);
  return { list, remove };
}

export function openTimes(app: App, slug: string, opts: TimesOptions = {}): void {
  const meta = app.meta(slug);
  const laps = getLaps(slug);
  const pole = `Pole pace ${formatLap(meta.poleRef * 1000)}`;
  const sub = laps.length ? `${pole} · ${laps.length} ${laps.length === 1 ? 'lap' : 'laps'}` : pole;
  const { list, remove } = lapSheet(app, `${meta.short}, your times`, sub, 'Close your times', `Your ${LAPS_KEPT} quickest laps here stay on this device.`);

  if (!laps.length) {
    list.append(h('li', { class: 'board-status' }, 'No lap yet. Draw one and it lands here.'));
    return;
  }
  // Once the replay is on screen the sheet gets out of its way.
  const watch = opts.watch ? (index: number) => opts.watch!(index).then(remove) : undefined;
  laps.forEach((lap, i) => list.append(lapRow(lap, i, laps[0].timeMs, meta.poleRef, slug, { copied: opts.copied, watch })));
}

export interface LinePickerOptions {
  /** Open the saved line at this index (0 is the quickest) to edit; rejects when it cannot be. */
  edit(index: number): Promise<void>;
}

/** Pick one of your saved lines on a circuit to edit. Each row is one tap from the editor. */
export function openLinePicker(app: App, slug: string, opts: LinePickerOptions): void {
  const meta = app.meta(slug);
  const laps = getLaps(slug);
  const sub = `${meta.short} · ${laps.length} saved ${laps.length === 1 ? 'line' : 'lines'}`;
  const { list, remove } = lapSheet(app, 'Edit a line', sub, 'Close', 'It opens whole. Touch it where a change starts, redraw that part, then rejoin the rest.');
  if (!laps.length) {
    list.append(h('li', { class: 'board-status' }, 'No saved line yet. Draw a lap and it lands here.'));
    return;
  }
  laps.forEach((lap, i) => {
    const li = h('li', { class: `board-entry${i === 0 ? ' is-you' : ''}` });
    const status = h('p', { class: 'board-note is-error', role: 'status', hidden: true });
    const slot = gridSlot(lap.timeMs, meta.poleRef);
    const icon = h('span', { class: 'board-play is-edit', 'aria-hidden': 'true', html: ICONS.edit });
    const open = h('button', { class: 'board-open', 'aria-label': `Edit lap ${i + 1}, ${formatLap(lap.timeMs)}` }) as HTMLButtonElement;
    open.onclick = () => {
      sfx.tap();
      open.disabled = true;
      icon.classList.add('is-loading');
      opts.edit(i).then(remove, () => {
        open.disabled = false;
        icon.classList.remove('is-loading');
        status.textContent = 'That line can’t be edited.';
        status.hidden = false;
      });
    };
    const row = h(
      'div',
      { class: 'board-row is-openable' },
      open,
      h('span', { class: 'board-rank' }, String(i + 1)),
      h('span', { class: 'board-name' }, h('span', { class: 'board-name-text' }, whenText(lap.date)), h('span', { class: `board-slot slot tier-${slot.tier}` }, slot.stamp)),
      h('span', { class: 'board-tyre', html: tyreBadge(lap.compound, 18) }),
      h('span', { class: 'board-time' }, h('b', null, formatLap(lap.timeMs)), h('small', null, i === 0 ? '' : formatDelta(lap.timeMs - laps[0].timeMs))),
      icon,
    );
    li.append(row, status);
    list.append(li);
  });
}

/** How a lap was drawn, in the settings' own words. */
function setupText(setup: DrawSetup, compound: Compound): string {
  const parts: string[] = [drawModeText(setup.drawMode)];
  // Tap and bend never scrolls under the finger, so the scroll settings say nothing about it.
  if (setup.drawMode !== 'curves' && setup.scrollMode === 'pause') {
    parts.push('pause my stroke');
  } else if (setup.drawMode !== 'curves') {
    parts.push(`keep drawing at ${setup.scrollSpeed.toFixed(2)}×`);
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
