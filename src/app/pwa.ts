// Home screen install and lap alerts (push notifications when someone beats
// one of your times). Everything here is optional: the game never waits on it.

import { getPlayer, getSettings, saveSettings } from './store';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const installListeners = new Set<() => void>();

/** Called when installing becomes possible or the game gets installed. Returns an unsubscribe. */
export function onInstallChange(fn: () => void): () => void {
  installListeners.add(fn);
  return () => installListeners.delete(fn);
}

const installChanged = () => installListeners.forEach((fn) => fn());

export function initPwa(onOpen: (search: string) => void): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Hold the browser's install prompt for our own moment, after a lap.
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    installChanged();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    saveSettings({ installPrompted: true });
    installChanged();
  });
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (e) => {
    const d = e.data as { type?: string; search?: string } | null;
    if (d?.type === 'open' && typeof d.search === 'string') onOpen(d.search);
  });
  navigator.serviceWorker
    .register('/sw.js')
    .then(() => refreshAlerts())
    .catch(() => {});
}

export function isInstalled(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

/** iPhone and iPad have no install prompt; the player adds the game from the Share menu. */
export function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function canPromptInstall(): boolean {
  return deferred !== null;
}

export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  deferred = null;
  await e.prompt();
  const choice = await e.userChoice;
  return choice.outcome === 'accepted';
}

export function alertsSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function alertsBlocked(): boolean {
  return alertsSupported() && Notification.permission === 'denied';
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const bin = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function send(method: 'POST' | 'DELETE', body: unknown): Promise<void> {
  const res = await fetch('/api/push', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function subscribe(): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const res = await fetch('/api/push');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { publicKey } = (await res.json()) as { publicKey: string };
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  }
  await send('POST', { playerId: getPlayer().id, subscription: sub.toJSON() });
}

export type AlertsResult = 'on' | 'denied' | 'unsupported' | 'failed';

/** Ask for permission (call from a tap) and register this device for alerts. */
export async function enableAlerts(): Promise<AlertsResult> {
  if (!alertsSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  try {
    await subscribe();
    saveSettings({ alerts: true });
    return 'on';
  } catch {
    return 'failed';
  }
}

export async function disableAlerts(): Promise<void> {
  saveSettings({ alerts: false });
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    await sub?.unsubscribe();
  } catch {
    /* already gone */
  }
  await send('DELETE', { playerId: getPlayer().id }).catch(() => {});
}

/** Keep the server's copy of an active subscription fresh; notice when permission was taken away. */
async function refreshAlerts(): Promise<void> {
  if (!getSettings().alerts || !alertsSupported()) return;
  if (Notification.permission !== 'granted') {
    saveSettings({ alerts: false });
    return;
  }
  await subscribe().catch(() => {});
}
