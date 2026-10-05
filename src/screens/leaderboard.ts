// Per-circuit world leaderboard as a bottom sheet.

import type { App } from '../app/app';
import { fetchBoard, renamePlayer, type BoardEntry } from '../app/api';
import { sfx } from '../app/audio';
import { CORNER_DAMPING_OPTIONS } from '../app/damping';
import { formatDelta, formatLap } from '../app/format';
import { applySetup, currentSetup, getPlayer, getTyre, sameSetup, setPlayerName, setTyre, type DrawSetup } from '../app/store';
import { flushUnsubmitted } from '../app/sync';
import { COMPOUND_SPECS } from '../sim/car';
import type { Compound } from '../sim/types';
import { ICONS, h, tyreBadge } from '../ui/dom';

export interface BoardOptions {
  /** Runs after the player copies someone's setup. */
  copied?: () => void;
  /** Start watching the lap at this rank; rejects when it cannot be replayed. */
  watch?: (rank: number) => Promise<void>;
}

export function openLeaderboard(app: App, slug: string, opts: BoardOptions = {}): void {
  const meta = app.meta(slug);
  const player = getPlayer();
  const list = h('ol', { class: 'board' }, h('li', { class: 'board-status' }, 'Loading times…'));
  const close = () => {
    overlay.classList.add('is-closing');
    setTimeout(() => overlay.remove(), 200);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  const closeBtn = h('button', { class: 'icon-btn', 'aria-label': 'Close leaderboard', html: ICONS.close, onclick: close });
  const head = h('header', { class: 'board-head' }, h('div', null, h('h2', { id: 'board-title' }, `${meta.short} world times`), h('p', null, `Pole pace ${formatLap(meta.poleRef * 1000)}`)), closeBtn);
  const sheet = h(
    'section',
    { class: 'sheet board-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'board-title' },
    head,
    list,
    nameRow(() => load()),
  );
  const overlay = h('div', { class: 'overlay', onclick: (e: Event) => e.target === overlay && close() }, sheet);
  app.root.append(overlay);
  document.addEventListener('keydown', onKey);
  // Keyboard users land on close; no focus ring flashes up for a tap.
  closeBtn.focus({ focusVisible: false } as FocusOptions);

  const sub = head.querySelector('p')!;
  const pole = `Pole pace ${formatLap(meta.poleRef * 1000)}`;
  const load = () =>
    fetchBoard(slug, getPlayer().id, 100)
      .then((b) => {
        list.innerHTML = '';
        sub.textContent = b.total ? `${pole} · ${b.total} ${b.total === 1 ? 'driver' : 'drivers'}` : pole;
        if (!b.entries.length) {
          list.append(h('li', { class: 'board-status' }, 'No times yet. Set the first one.'));
          return;
        }
        const lead = b.entries[0].timeMs;
        const watch = opts.watch
          ? (rank: number) =>
              opts.watch!(rank).then(() => {
                // The replay is on screen: get the sheet out of its way.
                overlay.remove();
                document.removeEventListener('keydown', onKey);
              })
          : undefined;
        for (const e of b.entries) list.append(entryRow(e, lead, slug, { copied: opts.copied, watch }));
        if (b.you && !b.entries.some((e) => e.you)) {
          list.append(
            h('li', { class: 'board-gapline', 'aria-hidden': 'true' }, '⋯'),
            entryRow({ rank: b.you.rank, name: player.name || 'You', timeMs: b.you.timeMs, compound: getTyre(slug), date: '', setup: null, replay: false, you: true }, lead, slug, {}),
          );
        }
      })
      .catch(() => {
        list.innerHTML = '';
        list.append(h('li', { class: 'board-status' }, 'The leaderboard is unreachable right now. Your times are saved on this device.'));
      });
  void load();
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

/**
 * One driver. A play button watches the lap; tapping a rival's row opens the
 * setup they drew it with, ready to copy.
 */
function entryRow(e: BoardEntry, lead: number, slug: string, opts: BoardOptions): HTMLElement {
  const setup = e.you ? null : e.setup;
  const li = h('li', { class: `board-entry${e.you ? ' is-you' : ''}` });
  const status = h('p', { class: 'board-note', role: 'status', hidden: true });
  const say = (text: string, error = false) => {
    status.textContent = text;
    status.classList.toggle('is-error', error);
    status.hidden = false;
  };

  const name = h('span', { class: 'board-name' }, h('span', { class: 'board-name-text' }, e.name), e.you ? h('span', { class: 'board-you' }, 'You') : null);
  const time = h('span', { class: 'board-time' }, h('b', null, formatLap(e.timeMs)), h('small', null, e.rank === 1 ? '' : formatDelta(e.timeMs - lead)));
  const cells = [h('span', { class: 'board-rank' }, String(e.rank)), name, h('span', { class: 'board-tyre', html: tyreBadge(e.compound, 18) }), time];

  let play: HTMLElement | null = null;
  if (e.replay && opts.watch) {
    const btn = h('button', {
      class: 'board-play',
      'aria-label': e.rank === 1 ? `Watch ${e.name}'s lap` : `Watch ${e.name}'s lap against P1`,
      title: e.rank === 1 ? 'Watch lap' : 'Watch against P1',
      html: ICONS.play,
    }) as HTMLButtonElement;
    btn.onclick = (ev: Event) => {
      ev.stopPropagation();
      sfx.tap();
      btn.disabled = true;
      btn.classList.add('is-loading');
      opts.watch!(e.rank).catch(() => {
        btn.disabled = false;
        btn.classList.remove('is-loading');
        say('That lap can’t be replayed right now.', true);
      });
    };
    play = btn;
  }

  if (!setup) {
    li.append(h('div', { class: 'board-row' }, ...cells, play ?? h('span', { class: 'board-play-gap' })), status);
    return li;
  }

  // Rivals with a recorded setup: the row opens to show it, with a copy button.
  const id = `board-setup-${++rowIds}`;
  const copy = h('button', { class: 'board-copy' }, 'Copy setup') as HTMLButtonElement;
  const sync = () => {
    const same = sameSetup(currentSetup(), setup) && getTyre(slug) === e.compound;
    copy.disabled = same;
    copy.textContent = same ? 'In use' : 'Copy setup';
  };
  copy.onclick = () => {
    applySetup(setup);
    setTyre(slug, e.compound);
    sfx.tap();
    copy.disabled = true;
    copy.textContent = 'Copied';
    opts.copied?.();
  };
  const detail = h('div', { class: 'board-setup', id, hidden: true }, h('p', null, setupText(setup, e.compound)), copy);
  name.append(h('span', { class: 'board-chevron', 'aria-hidden': 'true', html: ICONS.chevron }));
  const toggle = h('button', { class: 'board-open', 'aria-expanded': 'false', 'aria-controls': id, 'aria-label': `${e.name}'s setup` });
  const row = h('div', { class: 'board-row is-openable' }, ...cells, play ?? h('span', { class: 'board-play-gap' }));
  // The whole row opens the setup; the play button keeps its own tap.
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

/** "Posting as X" with an inline rename. */
function nameRow(onChange: () => void): HTMLElement {
  const row = h('div', { class: 'board-name-row' });
  const render = () => {
    row.innerHTML = '';
    const p = getPlayer();
    const label = h('span', null, p.name ? `Posting as ${p.name}` : 'Set a name to post your times');
    const edit = h('button', { class: 'btn-quiet', onclick: () => openForm() }, p.name ? 'Change' : 'Set name');
    row.append(label, edit);
  };
  const openForm = () => {
    row.innerHTML = '';
    const input = h('input', { class: 'name-input', type: 'text', maxlength: '14', value: getPlayer().name, 'aria-label': 'Your name', enterkeyhint: 'done' }) as HTMLInputElement;
    const status = h('span', { class: 'board-name-status' });
    const form = h(
      'form',
      {
        class: 'name-form',
        onsubmit: (e: Event) => {
          e.preventDefault();
          const name = input.value.trim().replace(/\s+/g, ' ');
          if (!/^[A-Za-z0-9 _.-]{2,14}$/.test(name)) {
            status.textContent = 'Use 2 to 14 letters or numbers.';
            return;
          }
          const had = getPlayer().name;
          setPlayerName(name);
          const done = () => {
            render();
            onChange();
          };
          if (had) renamePlayer(getPlayer().id, name).then(done, done);
          else flushUnsubmitted().then(done, done);
        },
      },
      input,
      h('button', { class: 'btn-ink', type: 'submit' }, 'Save'),
    );
    row.append(form, status);
    input.focus();
  };
  render();
  return row;
}
