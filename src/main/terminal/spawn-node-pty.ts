import type { PtyProcess, PtySpawnOptions } from '#internal/terminal/pty-process.ts';

/**
 * Starts a pseudo-terminal with `node-pty` (ADR 0095). The module is loaded on first use, so a
 * missing native binary makes opening a terminal fail with a message and never the app's start.
 */
export async function spawnNodePty(options: PtySpawnOptions): Promise<PtyProcess> {
  const nodePty = await import('node-pty');
  const child = nodePty.spawn(options.file, [...options.args], {
    name: 'xterm-256color',
    cols: options.size.cols,
    rows: options.size.rows,
    cwd: options.cwd,
    env: { ...options.env },
    encoding: 'utf8',
  });
  return {
    pid: child.pid,
    write: (data): void => {
      child.write(data);
    },
    resize: (size): void => {
      child.resize(size.cols, size.rows);
    },
    kill: (): void => {
      child.kill();
    },
    onData: (listener): (() => void) => {
      const subscription = child.onData(listener);
      return (): void => {
        subscription.dispose();
      };
    },
    onExit: (listener): (() => void) => {
      const subscription = child.onExit((exit) => {
        listener({ exitCode: exit.exitCode, signal: exit.signal });
      });
      return (): void => {
        subscription.dispose();
      };
    },
  };
}
