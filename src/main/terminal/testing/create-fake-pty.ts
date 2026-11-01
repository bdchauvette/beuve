import type {
  PtyExit,
  PtyProcess,
  PtySpawner,
  PtySpawnOptions,
  TerminalSize,
} from '#internal/terminal/pty-process.ts';

/** A controllable stand-in for `node-pty`: records what it was asked and emits what a test says. */
export interface FakePty {
  readonly spawn: PtySpawner;
  readonly spawned: readonly PtySpawnOptions[];
  readonly writes: readonly string[];
  readonly resizes: readonly TerminalSize[];
  readonly killCount: () => number;
  /** Output from the latest shell. */
  readonly emit: (data: string) => void;
  /** Ends the latest shell. */
  readonly exit: (exit: PtyExit) => void;
  /** Makes the next spawn fail with `message`. */
  readonly failNextSpawn: (message: string) => void;
}

export function createFakePty(): FakePty {
  const spawned: PtySpawnOptions[] = [];
  const writes: string[] = [];
  const resizes: TerminalSize[] = [];
  const state = {
    kills: 0,
    failure: undefined as string | undefined,
    dataListener: undefined as ((data: string) => void) | undefined,
    exitListener: undefined as ((exit: PtyExit) => void) | undefined,
  };
  const spawn: PtySpawner = async (options) => {
    await Promise.resolve();
    if (state.failure !== undefined) {
      const message = state.failure;
      state.failure = undefined;
      throw new Error(message);
    }
    spawned.push(options);
    const process: PtyProcess = {
      pid: 1000 + spawned.length,
      write: (data): void => {
        writes.push(data);
      },
      resize: (size): void => {
        resizes.push(size);
      },
      kill: (): void => {
        state.kills += 1;
      },
      onData: (listener): (() => void) => {
        state.dataListener = listener;
        return (): void => {
          state.dataListener = undefined;
        };
      },
      onExit: (listener): (() => void) => {
        state.exitListener = listener;
        return (): void => {
          state.exitListener = undefined;
        };
      },
    };
    return process;
  };
  return {
    spawn,
    spawned,
    writes,
    resizes,
    killCount: (): number => {
      return state.kills;
    },
    emit: (data): void => {
      state.dataListener?.(data);
    },
    exit: (exit): void => {
      state.exitListener?.(exit);
    },
    failNextSpawn: (message): void => {
      state.failure = message;
    },
  };
}
