import type { InvokeChannel } from './ipc-contract.ts';

/** Every invoke channel name, for runtime allow-listing in preload and main. */
export const invokeChannels = Object.freeze([
  'app:get-info',
  'session:list',
  'session:open',
  'session:create-local',
  'session:get-review',
  'session:mark-reviewed',
  'session:get-impact',
  'session:get-file-pair',
  'session:get-tree',
  'lsp:call-hierarchy',
  'review:run',
  'review:list-insights',
  'review:set-insight-status',
] as const satisfies readonly InvokeChannel[]);
