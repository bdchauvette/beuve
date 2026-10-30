import type { EventChannel } from './ipc-contract.ts';

/** Every push channel name, for runtime allow-listing in preload. */
export const eventChannels = Object.freeze([
  'mcp:status',
  'chat:delta',
  'chat:message-updated',
  'ura:changed',
  'github:pr-updated',
  'github:ci-status',
  'trace:status',
] as const satisfies readonly EventChannel[]);
