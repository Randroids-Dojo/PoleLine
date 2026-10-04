// Livery picker: every colour scheme as a car preview in a bottom sheet.

import type { App } from '../app/app';
import { sfx } from '../app/audio';
import { getSettings, saveSettings } from '../app/store';
import { liveryPreview } from '../render/car-art';
import { LIVERIES } from '../render/liveries';
import { ICONS, h } from '../ui/dom';

export function openGarage(app: App, onPick: (id: string) => void): void {
  const close = () => {
    overlay.classList.add('is-closing');
    setTimeout(() => overlay.remove(), 200);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  const current = getSettings().livery;
  const grid = h('div', { class: 'garage-grid', role: 'radiogroup', 'aria-label': 'Car livery' });
  for (const l of LIVERIES) {
    const on = l.id === current;
    const card = h(
      'button',
      {
        class: `garage-card${on ? ' is-on' : ''}`,
        role: 'radio',
        'aria-checked': on ? 'true' : 'false',
        onclick: () => {
          sfx.tap();
          saveSettings({ livery: l.id });
          onPick(l.id);
          close();
        },
      },
      h('img', { src: liveryPreview(l, 'right'), alt: '' }),
      h('span', null, l.name),
    );
    grid.append(card);
  }
  const closeBtn = h('button', { class: 'icon-btn', 'aria-label': 'Close', html: ICONS.close, onclick: close });
  const sheet = h(
    'section',
    { class: 'sheet garage-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'garage-title' },
    h('header', { class: 'board-head' }, h('div', null, h('h2', { id: 'garage-title' }, 'Your car'), h('p', null, 'Team colours from this season, plus our own.')), closeBtn),
    grid,
  );
  const overlay = h('div', { class: 'overlay', onclick: (e: Event) => e.target === overlay && close() }, sheet);
  app.root.append(overlay);
  document.addEventListener('keydown', onKey);
  closeBtn.focus();
}
