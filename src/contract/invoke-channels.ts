import type { InvokeChannel } from './ipc-contract.ts';

/** Every invoke channel name, for runtime allow-listing in preload and main. */
export const invokeChannels = Object.freeze([
  'app:get-info',
  'session:list',
  'session:open',
] as const satisfies readonly InvokeChannel[]);
