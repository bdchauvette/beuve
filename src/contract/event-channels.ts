import type { EventChannel } from './ipc-contract.ts';

/** Every push channel name, for runtime allow-listing in preload. */
export const eventChannels = Object.freeze([
  'mcp:status',
  'chat:stream',
  'ura:changed',
  'github:pr-updated',
  'github:ci-status',
  'trace:status',
  'terminal:data',
  'terminal:exit',
  'menu:run',
  'settings:changed',
] as const satisfies readonly EventChannel[]);
