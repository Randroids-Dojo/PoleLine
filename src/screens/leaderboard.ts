// Per-circuit world leaderboard as a bottom sheet.

import type { App } from '../app/app';
import { fetchBoard } from '../app/api';
import { formatDelta, formatLap } from '../app/format';
import { getPlayer } from '../app/store';
import { ICONS, h, tyreBadge } from '../ui/dom';

export function openLeaderboard(app: App, slug: string): void {
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
  );
  const overlay = h('div', { class: 'overlay', onclick: (e: Event) => e.target === overlay && close() }, sheet);
  app.root.append(overlay);
  document.addEventListener('keydown', onKey);
  closeBtn.focus();

  fetchBoard(slug, player.id, 100)
    .then((b) => {
      list.innerHTML = '';
      if (!b.entries.length) {
        list.append(h('li', { class: 'board-status' }, 'No times yet. Set the first one.'));
        return;
      }
      const lead = b.entries[0].timeMs;
      for (const e of b.entries) {
        list.append(
          h(
            'li',
            { class: `board-row${e.you ? ' is-you' : ''}` },
            h('span', { class: 'board-rank' }, String(e.rank)),
            h('span', { class: 'board-name' }, e.name),
            h('span', { class: 'board-tyre', html: tyreBadge(e.compound, 18) }),
            h('span', { class: 'board-time' }, formatLap(e.timeMs)),
            h('span', { class: 'board-gap' }, e.rank === 1 ? '' : formatDelta(e.timeMs - lead)),
          ),
        );
      }
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
}
