import type { BeuveApi } from '../contract/ipc-contract.ts';

declare global {
  /** `window.beuve`, exposed by the preload (`src/preload/index.ts`); absent outside Electron. */
  var beuve: BeuveApi | undefined;
}

/** The preload bridge, or `undefined` when the page runs without it (e.g. in a plain browser). */
export function beuveBridge(): BeuveApi | undefined {
  return globalThis.beuve;
}
