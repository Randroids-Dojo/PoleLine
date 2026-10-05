// After-lap prompts, each offered once: add the game to the home screen, then
// turn on lap alerts. Settings keeps a lap alerts switch for later.

import type { App } from '../app/app';
import { alertsBlocked, alertsSupported, canPromptInstall, enableAlerts, isInstalled, isIos, promptInstall } from '../app/pwa';
import { getSettings, saveSettings } from '../app/store';
import { h, svg } from '../ui/dom';

const BELL =
  '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M6 16.5V11a6 6 0 0112 0v5.5l1.6 2H4.4z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M9.8 20.5a2.3 2.3 0 004.4 0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
const SHARE =
  '<svg class="ask-share" viewBox="0 0 24 24" width="18" height="18" aria-label="Share"><path d="M12 3v12M7.5 7.5L12 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 11H6v10h12V11h-2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>';

interface Ask {
  icon: Node;
  title: string;
  body: Node | string;
  yes: string;
  no?: string;
  /** Runs on yes with the sheet still open; a returned message is shown before closing. */
  act?: { busy: string; run: () => Promise<string | null> };
}

function ask(app: App, o: Ask): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const close = (answer: boolean) => {
      if (done) return;
      done = true;
      overlay.classList.add('is-closing');
      setTimeout(() => overlay.remove(), 200);
      document.removeEventListener('keydown', onKey);
      resolve(answer);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
    };
    const text = h('p', { class: 'ask-body' }, o.body);
    const no = o.no ? h('button', { class: 'btn-quiet', onclick: () => close(false) }, o.no) : null;
    const yes = h('button', { class: 'btn-primary' }, o.yes) as HTMLButtonElement;
    yes.onclick = async () => {
      if (!o.act) return close(true);
      yes.disabled = true;
      yes.textContent = o.act.busy;
      no?.remove();
      const after = await o.act.run();
      if (!after) return close(true);
      text.textContent = after;
      yes.disabled = false;
      yes.textContent = 'Close';
      yes.onclick = () => close(true);
    };
    const sheet = h(
      'section',
      { class: 'sheet ask-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ask-title' },
      h('div', { class: 'ask-icon' }, o.icon),
      h('h2', { id: 'ask-title' }, o.title),
      text,
      h('div', { class: 'ask-actions' }, yes, no),
    );
    const overlay = h('div', { class: 'overlay', onclick: (e: Event) => e.target === overlay && close(false) }, sheet);
    app.root.append(overlay);
    document.addEventListener('keydown', onKey);
    yes.focus();
  });
}

const appIcon = () => h('img', { src: '/icon-192.png', alt: '', width: '56', height: '56' });

let running = false;

/** Called once a lap's result has landed. Shows whichever prompts are still due. */
export async function promptAfterLap(app: App): Promise<void> {
  if (running) return;
  running = true;
  try {
    if (!getSettings().installPrompted) {
      if (isInstalled()) {
        saveSettings({ installPrompted: true });
      } else if (canPromptInstall()) {
        saveSettings({ installPrompted: true });
        const yes = await ask(app, {
          icon: appIcon(),
          title: 'Add PoleLine to your home screen',
          body: 'It opens full screen like an app, one tap from your next lap.',
          yes: 'Add to home screen',
          no: 'Not now',
        });
        if (yes) await promptInstall().catch(() => false);
        await pause(450);
      } else if (isIos()) {
        saveSettings({ installPrompted: true });
        await ask(app, {
          icon: appIcon(),
          title: 'Add PoleLine to your home screen',
          body: h('span', null, 'Tap ', svg(SHARE), ' Share, then ', h('b', null, 'Add to Home Screen'), '. Open it from there to turn on lap alerts too.'),
          yes: 'Got it',
        });
        // On iPhone, notifications only work in the home screen app.
        return;
      }
    }
    const s = getSettings();
    if (s.alertsPrompted || s.alerts || !alertsSupported() || alertsBlocked()) return;
    saveSettings({ alertsPrompted: true });
    await ask(app, {
      icon: h('span', { class: 'ask-bell', html: BELL }),
      title: 'Know when your time is beaten',
      body: 'Get a notification when someone beats one of your laps on the world leaderboard.',
      yes: 'Turn on lap alerts',
      no: 'Not now',
      act: {
        busy: 'Turning on…',
        run: async () => {
          const r = await enableAlerts();
          if (r === 'on') return 'Lap alerts are on. Switch them off any time in settings.';
          if (r === 'denied') return 'Notifications are blocked for PoleLine. You can allow them in your browser’s site settings.';
          return 'Lap alerts could not be turned on right now. You can try again in settings.';
        },
      },
    });
  } finally {
    running = false;
  }
}

function pause(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
