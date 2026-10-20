// Which edition this build is. The web edition races real circuits and posts
// to the world leaderboard; the Toybox edition is the paid mobile app: made-up
// circuits and teams, everything on the device, nothing on a server.

export type Edition = 'web' | 'toybox';

export const EDITION: Edition = __EDITION__ === 'toybox' ? 'toybox' : 'web';

/** No leaderboard, alerts, install prompts or update checks: the game never talks to a server. */
export const LOCAL_ONLY = EDITION === 'toybox';

/** The mobile app's marketing version; the web edition identifies itself by commit. */
export const APP_RELEASE = '1.0.0';

/** The circuits are made up, so copy must not call them real or compare them with a real series. */
export const REAL_CIRCUITS = EDITION === 'web';
