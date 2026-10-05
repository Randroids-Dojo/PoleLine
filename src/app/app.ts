// App shell: owns the full-screen world canvas, the frame loop, track loading
// and screen switching.

import { CATALOG } from '../data/catalog';
import { GEOMETRY_LOADERS } from '../data/geometry-loaders';
import { TrackArt } from '../render/track-art';
import { buildTrack, type Track } from '../sim/track';
import type { TrackMeta } from '../sim/types';

export interface Screen {
  frame?(now: number, dt: number): void;
  resize?(): void;
  destroy(): void;
}

export class App {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly root: HTMLElement;
  dpr = 1;
  w = 1;
  h = 1;
  private screen: Screen | null = null;
  private tracks = new Map<string, Track>();
  private arts = new Map<string, TrackArt>();
  private last = 0;

  constructor() {
    this.canvas = document.getElementById('world') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
    this.root = document.getElementById('app')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.visualViewport?.addEventListener('resize', () => this.resize());
    // Block page gestures that fight with drawing (pinch zoom, double-tap zoom).
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
    requestAnimationFrame((t) => this.loop(t));
  }

  meta(slug: string): TrackMeta {
    return CATALOG.find((m) => m.slug === slug) ?? CATALOG.find((m) => !m.tutorial)!;
  }

  /** Championship round number (the tutorial circuit is not a round: 0). */
  round(slug: string): number {
    const rounds = CATALOG.filter((m) => !m.tutorial);
    return rounds.findIndex((m) => m.slug === slug) + 1;
  }

  async track(slug: string): Promise<Track> {
    const cached = this.tracks.get(slug);
    if (cached) return cached;
    const loader = GEOMETRY_LOADERS[slug];
    const mod = await loader();
    const t = buildTrack(this.meta(slug), mod.default);
    this.tracks.set(slug, t);
    return t;
  }

  art(track: Track): TrackArt {
    let a = this.arts.get(track.meta.slug);
    if (!a) {
      a = new TrackArt(track, this.ctx);
      this.arts.set(track.meta.slug, a);
    }
    return a;
  }

  get current(): Screen | null {
    return this.screen;
  }

  /** Runs after every screen change (the update banner only shows on calm screens). */
  onShow: ((screen: Screen) => void) | null = null;

  show(screen: Screen): void {
    if (this.screen) this.screen.destroy();
    this.screen = screen;
    this.onShow?.(screen);
  }

  setCanvasVisible(on: boolean): void {
    this.canvas.style.visibility = on ? 'visible' : 'hidden';
  }

  private resize(): void {
    const vv = window.visualViewport;
    this.w = Math.round(vv?.width ?? window.innerWidth);
    this.h = Math.round(vv?.height ?? window.innerHeight);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    document.documentElement.style.setProperty('--vh', `${this.h}px`);
    this.screen?.resize?.();
  }

  private loop(t: number): void {
    const dt = this.last ? Math.min(0.05, (t - this.last) / 1000) : 0;
    this.last = t;
    try {
      this.screen?.frame?.(t, dt);
    } catch (err) {
      console.error(err);
    }
    requestAnimationFrame((n) => this.loop(n));
  }
}
