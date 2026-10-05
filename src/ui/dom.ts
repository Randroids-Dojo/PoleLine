// Minimal element builder. Keeps screens readable without a framework.

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style') el.setAttribute('style', String(v));
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === 'html') el.innerHTML = String(v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export function svg(markup: string): SVGSVGElement {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild as SVGSVGElement;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Set text only when it changed (cheap per-frame HUD updates). */
export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export const ICONS = {
  close: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  undo: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M9 7L4 12l5 5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 12H14a5.5 5.5 0 010 11h-2" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  restart: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M20 12a8 8 0 11-2.4-5.7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  soundOn: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  soundOff: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 9.5l5 5m0-5l-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  skip: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M5 5l8 7-8 7zM13 5l8 7-8 7z" fill="currentColor"/></svg>',
  gear: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 8.6a3.4 3.4 0 100 6.8 3.4 3.4 0 000-6.8z" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M19.4 13.5l1.7 1.3-1.8 3.1-2-.8a7.7 7.7 0 01-2.2 1.3l-.3 2.1h-3.6l-.3-2.1a7.7 7.7 0 01-2.2-1.3l-2 .8-1.8-3.1 1.7-1.3a7.6 7.6 0 010-2.6L2.9 9.6l1.8-3.1 2 .8a7.7 7.7 0 012.2-1.3l.3-2.1h3.6l.3 2.1a7.7 7.7 0 012.2 1.3l2-.8 1.8 3.1-1.7 1.3a7.6 7.6 0 010 2.6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>',
  board: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 20V11h4v9M10 20V5h4v15M16 20v-6h4v6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>',
};

export function tyreBadge(compound: 'soft' | 'medium' | 'hard', size = 22): string {
  const color = compound === 'soft' ? 'var(--soft)' : compound === 'medium' ? 'var(--medium)' : 'var(--hard)';
  const letter = compound === 'soft' ? 'S' : compound === 'medium' ? 'M' : 'H';
  return `<svg class="tyre-badge" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#000"/><circle cx="12" cy="12" r="8.2" fill="none" stroke="${color}" stroke-width="2.6"/><text x="12" y="16" text-anchor="middle" font-size="10.5" font-weight="800" fill="#fff" font-family="Archivo Variable, sans-serif">${letter}</text></svg>`;
}
