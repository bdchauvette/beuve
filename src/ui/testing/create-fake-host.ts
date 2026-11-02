import type { ReactiveControllerHost } from 'lit';

/** A controller host that counts its re-render requests. */
export interface FakeHost {
  readonly host: ReactiveControllerHost;
  readonly updates: () => number;
}

export function createFakeHost(): FakeHost {
  let updates = 0;
  const host = {
    addController: (): undefined => {
      return;
    },
    requestUpdate: (): void => {
      updates += 1;
    },
  } as unknown as ReactiveControllerHost;
  return { host, updates: (): number => updates };
}
