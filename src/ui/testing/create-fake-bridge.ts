import type { BeuveApi } from '#contract/ipc-contract.ts';

/** A fake preload bridge with what it saw. */
export interface FakeBridge {
  readonly bridge: BeuveApi;
  /** `[channel, request]` of each `invoke`, in order. */
  readonly invoked: readonly (readonly [string, unknown])[];
  /** Delivers an event to the listener of `channel`, if one is subscribed. */
  readonly emit: (channel: string, payload: unknown) => void;
  /** How many channels have a listener. */
  readonly listening: () => number;
}

/** Options of {@link createFakeBridge}. */
export interface FakeBridgeOptions {
  /** The whole result each channel's `invoke` answers with; unlisted channels answer `ok`. */
  readonly replies?: Readonly<Record<string, unknown>>;
}

export function createFakeBridge(options: FakeBridgeOptions = {}): FakeBridge {
  const invoked: (readonly [string, unknown])[] = [];
  const listeners = new Map<string, (payload: unknown) => void>();
  const bridge = {
    invoke: async (channel: string, request: unknown): Promise<unknown> => {
      await Promise.resolve();
      invoked.push([channel, request]);
      return options.replies?.[channel] ?? { ok: true, value: undefined };
    },
    on: (channel: string, listener: (payload: unknown) => void): (() => void) => {
      listeners.set(channel, listener);
      return (): void => {
        listeners.delete(channel);
      };
    },
  } as unknown as BeuveApi;
  return {
    bridge,
    invoked,
    emit: (channel, payload): void => {
      listeners.get(channel)?.(payload);
    },
    listening: (): number => {
      return listeners.size;
    },
  };
}
