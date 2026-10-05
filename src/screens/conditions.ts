// A circuit's locked conditions and layout, kept off the home screen until asked for.

import type { App } from '../app/app';
import { downforceLabel, gripLabel, tyreHint, windText } from '../app/describe';
import type { TrackMeta } from '../sim/types';
import { ICONS, h } from '../ui/dom';

export function openConditions(app: App, m: TrackMeta): void {
  const close = () => {
    overlay.classList.add('is-closing');
    setTimeout(() => overlay.remove(), 200);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  const fact = (label: string, value: string, extra?: Node) => h('div', null, h('dt', null, label), h('dd', null, value, extra ?? null));
  const closeBtn = h('button', { class: 'icon-btn', 'aria-label': 'Close conditions', html: ICONS.close, onclick: close });
  const sheet = h(
    'section',
    { class: 'sheet settings-sheet conditions-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'conditions-title' },
    h('header', { class: 'board-head' }, h('div', null, h('h2', { id: 'conditions-title' }, `${m.short} conditions`), h('p', null, m.name)), closeBtn),
    h(
      'div',
      { class: 'conditions-body' },
      h(
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
      ),
      h('p', { class: 'conditions-tip' }, tyreHint(m)),
      h('p', { class: 'conditions-note' }, 'Conditions are the same for every lap here, so times are comparable.'),
    ),
  );
  const overlay = h('div', { class: 'overlay', onclick: (e: Event) => e.target === overlay && close() }, sheet);
  app.root.append(overlay);
  document.addEventListener('keydown', onKey);
  closeBtn.focus({ focusVisible: false } as FocusOptions);
}
