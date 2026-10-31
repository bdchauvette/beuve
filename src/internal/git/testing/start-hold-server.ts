import { once } from 'node:events';
import net from 'node:net';
import type { AddressInfo } from 'node:net';

/** One process a hold script (`writeHoldScript`) started, waiting for the test. */
export interface HeldProcess {
  /** The arguments it was started with (a git wrapper's start at the hardening options). */
  readonly args: readonly string[];
  /** Lets it go on: a held git runs, a smudge filter answers, an upload-pack fails. */
  readonly release: () => void;
  /** How it ended: SIGTERM before release (`terminated`), or any other exit (`closed`). */
  readonly ended: Promise<'terminated' | 'closed'>;
}

/** Where hold scripts report; `next` hands out the processes in the order they connected. */
export interface HoldServer extends AsyncDisposable {
  readonly port: number;
  readonly next: () => Promise<HeldProcess>;
}

/**
 * A loopback TCP server that hold scripts connect to when they start (a hold-until-signal fake:
 * the test decides when each process may go on, never a timer). Closing it, or `signal`
 * aborting, drops every connection, which ends the processes still held.
 */
export async function startHoldServer(signal: AbortSignal): Promise<HoldServer> {
  const arrived: HeldProcess[] = [];
  const waiting: ((held: HeldProcess) => void)[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.setEncoding('utf8');
    let buffered = '';
    let hasArrived = false;
    let wasTerminated = false;
    const ended = new Promise<'terminated' | 'closed'>((resolve) => {
      socket.once('close', () => {
        sockets.delete(socket);
        if (wasTerminated) {
          resolve('terminated');
        } else {
          resolve('closed');
        }
      });
    });
    socket.on('error', () => {
      // The peer exits without closing politely when it is killed; `close` still follows.
    });
    socket.on('data', (chunk: string) => {
      buffered += chunk;
      let newline = buffered.indexOf('\n');
      while (newline !== -1) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        if (!hasArrived) {
          hasArrived = true;
          const held: HeldProcess = {
            args: JSON.parse(line) as string[],
            release: (): void => {
              socket.write('release\n');
            },
            ended,
          };
          const taker = waiting.shift();
          if (taker === undefined) {
            arrived.push(held);
          } else {
            taker(held);
          }
        } else if (line === 'terminated') {
          wasTerminated = true;
        }
        newline = buffered.indexOf('\n');
      }
    });
  });
  const close = async (): Promise<void> => {
    for (const socket of sockets) {
      socket.destroy();
    }
    if (!server.listening) {
      return;
    }
    server.close();
    // eslint-disable-next-line local/forward-abort-signal -- closing is what an abort does here.
    await once(server, 'close');
  };
  signal.addEventListener(
    'abort',
    () => {
      void close();
    },
    { once: true },
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening', { signal });
  return {
    port: (server.address() as AddressInfo).port,
    next: async (): Promise<HeldProcess> => {
      const held = arrived.shift();
      return (
        held ??
        new Promise<HeldProcess>((resolve) => {
          waiting.push(resolve);
        })
      );
    },
    [Symbol.asyncDispose]: close,
  };
}
