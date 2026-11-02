import type { CiStatusView } from '#contract/ipc-contract.ts';

/** A CI status; only its identity matters to the controller. */
export function createCiStatus(): CiStatusView {
  return { state: 'success' } as unknown as CiStatusView;
}
