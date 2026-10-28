import type { EventChannel } from './ipc-contract.ts';

/** Every push channel name, for runtime allow-listing in preload. */
export const eventChannels = Object.freeze([
  'mcp:status',
  'review:progress',
  'ura:changed',
] as const satisfies readonly EventChannel[]);
