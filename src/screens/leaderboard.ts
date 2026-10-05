// Per-circuit world leaderboard as a bottom sheet.

import type { App } from '../app/app';
import { fetchBoard, renamePlayer, type BoardEntry } from '../app/api';
import { sfx } from '../app/audio';
import { CORNER_DAMPING_OPTIONS } from '../app/damping';
import { formatDelta, formatLap } from '../app/format';
import { applySetup, currentSetup, getPlayer, getTyre, sameSetup, setPlayerName, setTyre, type DrawSetup } from '../app/store';
import { flushUnsubmitted } from '../app/sync';
import { COMPOUND_SPECS } from '../sim/car';
import { ICONS, h, tyreBadge } from '../ui/dom';

/** `copied` runs after the player copies someone's setup. */
export function openLeaderboard(app: App, slug: string, copied?: () => void): void {
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
  const sheet = h(
    'section',
    { class: 'sheet board-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'board-title' },
    h('header', { class: 'board-head' }, h('div', null, h('h2', { id: 'board-title' }, `${meta.short} world times`), h('p', null, `Pole pace ${formatLap(meta.poleRef * 1000)}`)), closeBtn),
    list,
    nameRow(() => load()),
  );
  const overlay = h('div', { class: 'overlay', onclick: (e: Event) => e.target === overlay && close() }, sheet);
  app.root.append(overlay);
  document.addEventListener('keydown', onKey);
  closeBtn.focus();

  const load = () =>
    fetchBoard(slug, getPlayer().id, 100)
    .then((b) => {
      list.innerHTML = '';
      if (!b.entries.length) {
        list.append(h('li', { class: 'board-status' }, 'No times yet. Set the first one.'));
        return;
      }
      const lead = b.entries[0].timeMs;
      if (b.entries.some((e) => e.setup && !e.you)) list.append(h('li', { class: 'board-hint' }, 'Tap a driver to see how they drew their lap and copy their setup.'));
      for (const e of b.entries) list.append(entryRow(e, lead, slug, copied));
      if (b.you && !b.entries.some((e) => e.you)) {
        list.append(
          h('li', { class: 'board-gapline', 'aria-hidden': 'true' }, '⋯'),
          h(
            'li',
            { class: 'board-row is-you' },
            h('span', { class: 'board-rank' }, String(b.you.rank)),
            h('span', { class: 'board-name' }, player.name || 'You'),
            h('span', { class: 'board-tyre' }),
            h('span', { class: 'board-time' }, formatLap(b.you.timeMs)),
            h('span', { class: 'board-gap' }, formatDelta(b.you.timeMs - lead)),
          ),
        );
      }
      const foot = h('li', { class: 'board-status' }, `${b.total} ${b.total === 1 ? 'driver' : 'drivers'} on this circuit`);
      list.append(foot);
    })
    .catch(() => {
      list.innerHTML = '';
      list.append(h('li', { class: 'board-status' }, 'The leaderboard is unreachable right now. Your times are saved on this device.'));
    });
  void load();
}

/** Short labels for how a lap was drawn, in the settings' own words. */
function setupChips(setup: DrawSetup): string[] {
  const chips: string[] = [];
  if (setup.scrollMode === 'pause') {
    chips.push('Pause my stroke');
  } else {
    chips.push(`Keep drawing ${setup.scrollSpeed.toFixed(2)}×`);
    const damping = CORNER_DAMPING_OPTIONS.find((o) => o.id === setup.cornerDamping);
    chips.push(setup.cornerDamping === 'off' || !damping ? 'No corner slowdown' : damping.label);
  }
  chips.push(setup.autoRotate ? 'Map rotates' : 'Map fixed');
  return chips;
}

let rowIds = 0;

/** A board row. Other drivers' rows open to show their setup with a copy button. */
function entryRow(e: BoardEntry, lead: number, slug: string, copied?: () => void): HTMLElement {
  const cells = [
    h('span', { class: 'board-rank' }, String(e.rank)),
    h('span', { class: 'board-name' }, e.name),
    h('span', { class: 'board-tyre', html: tyreBadge(e.compound, 18) }),
    h('span', { class: 'board-time' }, formatLap(e.timeMs)),
    h('span', { class: 'board-gap' }, e.rank === 1 ? '' : formatDelta(e.timeMs - lead)),
  ];
  const setup = e.setup;
  if (e.you || !setup) return h('li', { class: `board-row${e.you ? ' is-you' : ''}` }, ...cells);

  const id = `board-setup-${++rowIds}`;
  const status = h('span', { class: 'board-setup-status', role: 'status' });
  const copy = h('button', { class: 'btn-ink' }, 'Copy setup') as HTMLButtonElement;
  const sync = () => {
    const same = sameSetup(currentSetup(), setup) && getTyre(slug) === e.compound;
    copy.disabled = same;
    copy.textContent = same ? 'You use this setup' : 'Copy setup';
  };
  copy.onclick = () => {
    applySetup(setup);
    setTyre(slug, e.compound);
    sfx.tap();
    copy.disabled = true;
    copy.textContent = 'Copied';
    status.textContent = 'Your next lap here draws with this setup.';
    copied?.();
  };
  const detail = h(
    'div',
    { class: 'board-setup', id, hidden: true },
    h(
      'ul',
      { class: 'setup-chips', 'aria-label': `${e.name}'s setup` },
      ...setupChips(setup).map((c) => h('li', null, c)),
      h('li', { html: `${tyreBadge(e.compound, 14)}<span>${COMPOUND_SPECS[e.compound].label}</span>` }),
    ),
    h('div', { class: 'board-setup-actions' }, copy, status),
  );
  const li = h('li', { class: 'board-entry' });
  const row = h(
    'button',
    {
      class: 'board-row',
      'aria-expanded': 'false',
      'aria-controls': id,
      onclick: () => {
        const open = detail.hidden !== false;
        detail.hidden = !open;
        row.setAttribute('aria-expanded', String(open));
        li.classList.toggle('is-open', open);
        if (open) sync();
      },
    },
    ...cells,
  );
  li.append(row, detail);
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
