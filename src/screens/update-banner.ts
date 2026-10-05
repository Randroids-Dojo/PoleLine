// "New version ready" banner. It only shows on calm screens (home and
// results), so refreshing never costs a lap being drawn or raced; an update
// found mid-lap waits for the result.

import type { App, Screen } from '../app/app';
import { ICONS, h } from '../ui/dom';

export class UpdateBanner {
  private el: HTMLElement | null = null;
  private ready = false;
  private dismissed = false;

  constructor(
    private app: App,
    private calm: (screen: Screen | null) => boolean,
  ) {}

  /** A newer version is live. A dismissed banner comes back for the next one. */
  available(): void {
    this.ready = true;
    this.dismissed = false;
    this.sync();
  }

  /** Show or hide for the current screen. */
  sync(): void {
    const want = this.ready && !this.dismissed && this.calm(this.app.current);
    if (want && !this.el) {
      this.el = h(
        'div',
        { class: 'update-banner', role: 'status' },
        h('span', null, 'A new version of PoleLine is ready.'),
        h('button', { class: 'update-go', onclick: () => location.reload() }, 'Refresh'),
        h('button', {
          class: 'icon-btn update-close',
          'aria-label': 'Dismiss',
          html: ICONS.close,
          onclick: () => {
            this.dismissed = true;
            this.sync();
          },
        }),
      );
      this.app.root.append(this.el);
    } else if (!want && this.el) {
      this.el.remove();
      this.el = null;
    }
  }
}
