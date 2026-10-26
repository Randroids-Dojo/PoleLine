// The difficulty picker (easy, medium, hard), shown on the tutorial's welcome
// card, and the pause menu the tutorial offers in place of the settings gear:
// change how you draw, carry on, open every setting, or skip the tutorial.

import type { App } from '../app/app';
import { sfx } from '../app/audio';
import { DRAW_MODES, LEVEL_LABELS, type DrawMode } from '../app/draw-mode';
import { ICONS, h } from '../ui/dom';

/** One row per way of drawing, easiest first. Picking one calls `onPick` straight away. */
export function difficultyPicker(current: DrawMode, onPick: (m: DrawMode) => void): HTMLElement {
  const group = h('div', { class: 'diff', role: 'radiogroup', 'aria-label': 'Difficulty' });
  const sync = (mode: DrawMode) => {
    group.querySelectorAll<HTMLElement>('.diff-opt').forEach((b) => {
      const on = b.dataset.mode === mode;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  };
  for (const m of DRAW_MODES) {
    group.append(
      h(
        'button',
        {
          class: `diff-opt is-${m.level}`,
          role: 'radio',
          'data-mode': m.id,
          onclick: () => {
            sync(m.id);
            sfx.tap();
            onPick(m.id);
          },
        },
        h('span', { class: 'diff-level' }, LEVEL_LABELS[m.level]),
        h('span', { class: 'diff-text' }, h('b', null, m.label), h('small', null, m.short)),
      ),
    );
  }
  sync(current);
  return group;
}

export interface PauseActions {
  mode: DrawMode;
  pick(mode: DrawMode): void;
  /** The full settings sheet. */
  settings(): void;
  /** Leave the walkthrough (only offered during it). */
  skip?: () => void;
  /** The menu closed, however it was closed. */
  closed?: () => void;
}

export function openPauseMenu(app: App, a: PauseActions): void {
  let gone = false;
  const close = (then?: () => void) => {
    if (gone) return;
    gone = true;
    overlay.classList.add('is-closing');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => overlay.remove(), 200);
    a.closed?.();
    then?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  const resume = h('button', { class: 'btn-ink pause-resume', onclick: () => close() }, 'Resume');
  const sheet = h(
    'section',
    { class: 'sheet pause-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pause-title' },
    h('header', { class: 'board-head' }, h('h2', { id: 'pause-title' }, 'Paused'), h('button', { class: 'icon-btn', 'aria-label': 'Resume', html: ICONS.close, onclick: () => close() })),
    h(
      'div',
      { class: 'pause-body' },
      h('h3', null, 'Difficulty'),
      difficultyPicker(a.mode, (m) => a.pick(m)),
      h('p', { class: 'pause-note' }, 'Your line so far stays. Only how you carry on changes.'),
      resume,
      h(
        'div',
        { class: 'pause-more' },
        h('button', { class: 'btn-quiet', onclick: () => close(a.settings) }, 'All settings'),
        a.skip ? h('button', { class: 'btn-quiet', onclick: () => close(a.skip) }, 'Skip tutorial') : null,
      ),
    ),
  );
  const overlay = h('div', { class: 'overlay', onclick: (e: Event) => e.target === overlay && close() }, sheet);
  app.root.append(overlay);
  document.addEventListener('keydown', onKey);
  sfx.tap();
  resume.focus({ focusVisible: false } as FocusOptions);
}
