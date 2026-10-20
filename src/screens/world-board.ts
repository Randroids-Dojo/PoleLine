// The web edition's world leaderboard block on the results sheet: posts a
// personal best (asking for a name first) or reports where the player's best
// stands. The Toybox edition never imports this.

import { fetchBoard, submitLap } from '../app/api';
import { getPlayer, markSubmitted, setPlayerName } from '../app/store';
import { flushUnsubmitted } from '../app/sync';
import type { Track } from '../sim/track';
import { h, setText } from '../ui/dom';
import type { ResultsInput } from './results';

const NAME_RE = /^[A-Za-z0-9 _.-]{2,14}$/;

export interface WorldBoardInput {
  track: Track;
  input: ResultsInput;
  /** The results sheet's slot for the board status and name form. */
  world: HTMLElement;
  /** Runs once the lap has reached the board. */
  posted(): void;
}

export function worldBoard(o: WorldBoardInput): void {
  const { track, world } = o;
  const { lap, isPb, code } = o.input;
  const player = getPlayer();
  const slug = track.meta.slug;
  const status = h('p', { class: 'res-world-status' }, '');
  world.append(status);
  const post = (name: string) => {
    setText(status, 'Posting to the world leaderboard…');
    submitLap({ track: slug, compound: lap.compound, line: code, playerId: player.id, name, setup: o.input.setup })
      .then((r) => {
        markSubmitted(slug);
        void flushUnsubmitted(slug);
        if (r.timeMs !== lap.timeMs) console.warn('server time differs', r.timeMs, lap.timeMs);
        setText(status, r.rank ? `World #${r.rank} of ${r.total} on ${track.meta.short}` : 'Posted.');
        status.classList.add('is-rank');
        o.posted();
      })
      .catch((err: Error) => setText(status, `Not posted: ${err.message}. Your time is saved on this device.`));
  };
  if (!isPb) {
    fetchBoard(slug, player.id, 1)
      .then((b) => setText(status, b.you ? `Your best is world #${b.you.rank} of ${b.total}` : b.total ? `${b.total} drivers have set times here` : ''))
      .catch(() => setText(status, ''));
    return;
  }
  if (player.name) {
    post(player.name);
    return;
  }
  const field = h('input', { class: 'name-input', type: 'text', maxlength: '14', autocomplete: 'nickname', placeholder: 'Your name', 'aria-label': 'Your name for the leaderboard', enterkeyhint: 'send' }) as HTMLInputElement;
  const btn = h('button', { class: 'btn-ink', type: 'submit' }, 'Post time');
  const form = h(
    'form',
    {
      class: 'name-form',
      onsubmit: (e: Event) => {
        e.preventDefault();
        const name = field.value.trim().replace(/\s+/g, ' ');
        if (!NAME_RE.test(name)) {
          setText(status, 'Use 2 to 14 letters or numbers.');
          field.focus();
          return;
        }
        setPlayerName(name);
        form.remove();
        post(name);
      },
    },
    field,
    btn,
  );
  setText(status, 'Post this lap to the world leaderboard.');
  world.append(form);
}
