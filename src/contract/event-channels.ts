import type { EventChannel } from './ipc-contract.ts';

/** Every push channel name, for runtime allow-listing in preload. */
export const eventChannels = Object.freeze([
  'chat:stream',
  'ura:changed',
  'github:pr-updated',
  'github:ci-status',
  'terminal:data',
  'terminal:exit',
  'menu:run',
  'link:open-pr',
  'settings:changed',
] as const satisfies readonly EventChannel[]);
