/**
 * Starting the app: the saved round to carry on, and the first screen (the cover, or a ?play= deep-link round).
 * `src/main.ts` wires it to the screens.
 */
import { loadState, newLinkGame, parseDeepLink, type GameState, type PersistedGame } from './game/game';
import { forgetLegacyPalette } from './game/ink';

function storage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/** The saved round `raw` to carry on, or null. `discard` clears a save that can't be played on. */
export function restoreRound(raw: unknown, discard: () => void): PersistedGame | null {
  const saved = loadState(raw);
  if (saved && !saved.finished) return saved;
  // A save that can't be played on (an old 12-hole par-6 round, or junk) is discarded: the next round starts fresh.
  if (raw !== null && !saved) discard();
  return null;
}

/** The elements and screens boot() starts. */
export interface BootHost {
  tray: HTMLElement;
  cover: HTMLElement;
  /** The players' names from the prefs: a deep link plays the first `players=` of them. */
  names: readonly string[];
  layout(): void;
  renderCover(): void;
  openCover(): void;
  /** Make `round` the game and show its hole. */
  play(round: GameState): void;
}

export function boot(host: BootHost): void {
  const { tray, cover } = host;
  tray.hidden = true;
  forgetLegacyPalette(storage());
  host.layout();
  host.renderCover();
  // Debug/screenshot hook: ?play=<course>&players=<n>&hole=<n> jumps straight into a round. Legacy `golf` and `mode`
  // params are ignored.
  {
    const linkParams = new URLSearchParams(location.search);
    if (linkParams.has('play')) {
      const link = parseDeepLink(linkParams);
      const round = newLinkGame(link, host.names);
      cover.style.transition = 'none';
      host.openCover();
      host.play(round);
      requestAnimationFrame(() => (cover.style.transition = ''));
    }
  }
  // The desk stays hidden until the first screen is built (index.html), so no unlaid-out cover or header ever paints.
  document.documentElement.classList.remove('boot');
}
