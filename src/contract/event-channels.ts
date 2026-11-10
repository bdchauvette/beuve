import type { EventChannel } from './ipc-contract.ts';

/** Every push channel name, for runtime allow-listing in preload. */
export const eventChannels = Object.freeze([
  'chat:stream',
  'ura:changed',
  'github:pr-updated',
  'github:ci-status',
  'github:branch-updated',
  'queue:updated',
  'terminal:data',
  'terminal:exit',
  'setup:finished',
  'menu:run',
  'link:open-pr',
  'link:open-branch',
  'settings:changed',
] as const satisfies readonly EventChannel[]);
