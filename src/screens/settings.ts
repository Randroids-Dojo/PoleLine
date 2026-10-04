// Settings as a bottom sheet: sound, screen wake, and how the map scrolls
// while drawing.

import type { App } from '../app/app';
import { setSoundEnabled, sfx, unlockAudio } from '../app/audio';
import { SCROLL_SPEED_MAX, SCROLL_SPEED_MIN, getSettings, saveSettings, type ScrollMode, type Settings } from '../app/store';
import { setKeepAwake } from '../app/wake';
import { ICONS, h } from '../ui/dom';

export function openSettings(app: App, onChange?: (s: Settings) => void): void {
  const changed = (patch: Partial<Settings>) => {
    const s = saveSettings(patch);
    onChange?.(s);
    return s;
  };
  const close = () => {
    overlay.classList.add('is-closing');
    setTimeout(() => overlay.remove(), 200);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };

  const s = getSettings();
  const toggle = (label: string, detail: string, on: boolean, set: (v: boolean) => void) => {
    const input = h('input', { type: 'checkbox', role: 'switch', class: 'switch' }) as HTMLInputElement;
    input.checked = on;
    input.addEventListener('change', () => set(input.checked));
    return h('label', { class: 'set-row' }, h('span', { class: 'set-text' }, h('b', null, label), h('small', null, detail)), input);
  };

  const speed = h('input', {
    type: 'range',
    class: 'set-range',
    min: String(SCROLL_SPEED_MIN),
    max: String(SCROLL_SPEED_MAX),
    step: '0.05',
    'aria-label': 'Scroll speed',
  }) as HTMLInputElement;
  speed.value = String(s.scrollSpeed);
  const speedValue = h('output', { class: 'set-value' }, `${s.scrollSpeed.toFixed(2)}×`);
  speed.addEventListener('input', () => {
    const v = Number(speed.value);
    speedValue.textContent = `${v.toFixed(2)}×`;
    changed({ scrollSpeed: v });
  });
  const speedRow = h(
    'div',
    { class: 'set-speed' },
    h('div', { class: 'set-speed-head' }, h('b', null, 'Scroll speed'), speedValue),
    speed,
    h('div', { class: 'set-speed-scale', 'aria-hidden': 'true' }, h('span', null, 'Gentle'), h('span', null, 'Fast')),
  );

  const modes: { id: ScrollMode; label: string; detail: string }[] = [
    { id: 'pause', label: 'Pause my stroke', detail: 'The map glides on and your stroke ends. Lift, then carry on from the purple tip.' },
    { id: 'continuous', label: 'Keep drawing', detail: 'The map scrolls under your finger as you draw. Faster, but harder to control.' },
  ];
  const modeGroup = h('div', { class: 'set-modes', role: 'radiogroup', 'aria-label': 'When the map scrolls' });
  const syncSpeed = (mode: ScrollMode) => {
    speedRow.classList.toggle('is-off', mode !== 'continuous');
    speed.disabled = mode !== 'continuous';
  };
  for (const m of modes) {
    const input = h('input', { type: 'radio', name: 'scroll-mode', value: m.id }) as HTMLInputElement;
    input.checked = s.scrollMode === m.id;
    input.addEventListener('change', () => {
      if (!input.checked) return;
      changed({ scrollMode: m.id });
      syncSpeed(m.id);
    });
    modeGroup.append(h('label', { class: 'set-mode' }, input, h('span', { class: 'set-text' }, h('b', null, m.label), h('small', null, m.detail))));
  }
  syncSpeed(s.scrollMode);

  const closeBtn = h('button', { class: 'icon-btn', 'aria-label': 'Close settings', html: ICONS.close, onclick: close });
  const sheet = h(
    'section',
    { class: 'sheet settings-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'settings-title' },
    h('header', { class: 'board-head' }, h('h2', { id: 'settings-title' }, 'Settings'), closeBtn),
    h(
      'div',
      { class: 'settings-body' },
      h('h3', null, 'When the map scrolls while you draw'),
      modeGroup,
      speedRow,
      h('h3', null, 'Device'),
      toggle('Sound', 'Engine, timing beeps and alerts.', s.sound, (v) => {
        changed({ sound: v });
        setSoundEnabled(v);
        if (v) {
          unlockAudio();
          sfx.tap();
        }
      }),
      toggle('Keep the screen awake', 'Stops the screen dimming while you play.', s.keepAwake, (v) => {
        changed({ keepAwake: v });
        setKeepAwake(v);
      }),
    ),
  );
  const overlay = h('div', { class: 'overlay', onclick: (e: Event) => e.target === overlay && close() }, sheet);
  app.root.append(overlay);
  document.addEventListener('keydown', onKey);
  closeBtn.focus();
}
