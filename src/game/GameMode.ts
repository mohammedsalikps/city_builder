/**
 * High-level mode the application is in. Drives which UI screen is shown
 * and whether the world is interactive.
 *
 * Future modes (e.g. 'free-build', 'challenge') are added here.
 */
export type GameMode = 'boot' | 'menu' | 'world-map' | 'playing' | 'paused' | 'realworld';
