export const MINECRAFT_VERSION = '1.21.1';
export const NEOFORGE_VERSION = '21.1.256';
export const GAME_DIR_NAME = '.theageafter';
export const USER_AGENT = 'TheAgeAfterLauncher';

export const IPC = {
  invoke: 'launcher:invoke',
  progress: 'launcher:progress',
  gameState: 'launcher:game-state',
  update: 'launcher:update',
} as const;
