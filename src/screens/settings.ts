// Settings as a bottom sheet: sound, screen wake, and how the map scrolls
// while drawing.

import type { App } from '../app/app';
import { setSoundEnabled, sfx, unlockAudio } from '../app/audio';
import { SCROLL_SPEED_MAX, SCROLL_SPEED_MIN, getSettings, saveSettings, type ScrollMode, type Settings } from '../app/store';
import { setKeepAwake } from '../app/wake';
import { alertsBlocked, alertsSupported, disableAlerts, enableAlerts, isInstalled, isIos } from '../app/pwa';
import { CORNER_DAMPING_OPTIONS } from '../app/damping';
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

  const damping = h('div', { class: 'set-damping', role: 'radiogroup', 'aria-label': 'Slow down near corners' });
  for (const o of CORNER_DAMPING_OPTIONS) {
    const input = h('input', { type: 'radio', name: 'corner-damping', value: o.id }) as HTMLInputElement;
    input.checked = s.cornerDamping === o.id;
    input.addEventListener('change', () => {
      if (input.checked) changed({ cornerDamping: o.id });
    });
    damping.append(h('label', { class: 'set-damp' }, input, h('span', { class: 'set-text' }, h('b', null, o.label), h('small', null, o.detail))));
  }
  const dampingRow = h('div', { class: 'set-speed set-damping-row' }, h('div', { class: 'set-speed-head' }, h('b', null, 'Slow down near corners')), damping);

  const modes: { id: ScrollMode; label: string; detail: string }[] = [
    { id: 'pause', label: 'Pause my stroke', detail: 'The map glides on and your stroke ends. Lift, then carry on from the purple tip.' },
    { id: 'continuous', label: 'Keep drawing', detail: 'The map scrolls under your finger as you draw. Faster, but harder to control.' },
  ];
  const modeGroup = h('div', { class: 'set-modes', role: 'radiogroup', 'aria-label': 'When the map scrolls' });
  const syncSpeed = (mode: ScrollMode) => {
    const on = mode === 'continuous';
    speedRow.classList.toggle('is-off', !on);
    speed.disabled = !on;
    dampingRow.classList.toggle('is-off', !on);
    dampingRow.querySelectorAll('input').forEach((i) => ((i as HTMLInputElement).disabled = !on));
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
      dampingRow,
      h('h3', null, 'Map'),
      toggle('Rotate the map to follow the track', 'Turns the road ahead to point up. Off: the map stays where you put it with the compass.', s.autoRotate, (v) => {
        changed({ autoRotate: v });
      }),
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
      alertsRow(s.alerts),
    ),
  );
  const overlay = h('div', { class: 'overlay', onclick: (e: Event) => e.target === overlay && close() }, sheet);
  app.root.append(overlay);
  document.addEventListener('keydown', onKey);
  closeBtn.focus();
}

/** Lap alerts switch: asks for notification permission when turned on. */
function alertsRow(on: boolean): HTMLElement {
  const detail = 'A notification when someone beats one of your times.';
  const input = h('input', { type: 'checkbox', role: 'switch', class: 'switch' }) as HTMLInputElement;
  const small = h('small', null, detail);
  input.checked = on && alertsSupported() && !alertsBlocked();
  if (!alertsSupported()) {
    input.disabled = true;
    small.textContent = isIos() && !isInstalled() ? 'Add PoleLine to your home screen first (Share, then Add to Home Screen).' : 'This browser cannot show notifications.';
  } else if (alertsBlocked()) {
    input.disabled = true;
    small.textContent = 'Notifications are blocked for PoleLine in your browser’s site settings.';
  }
  input.addEventListener('change', async () => {
    input.disabled = true;
    if (!input.checked) {
      await disableAlerts();
      input.disabled = false;
      return;
    }
    small.textContent = 'Turning on…';
    const r = await enableAlerts();
    input.checked = r === 'on';
    input.disabled = r === 'denied';
    small.textContent =
      r === 'on' ? detail : r === 'denied' ? 'Notifications are blocked for PoleLine in your browser’s site settings.' : 'Lap alerts could not be turned on right now. Try again later.';
  });
  return h('label', { class: 'set-row' }, h('span', { class: 'set-text' }, h('b', null, 'Lap alerts'), small), input);
}
