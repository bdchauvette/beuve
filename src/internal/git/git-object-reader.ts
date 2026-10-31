import { spawn } from 'node:child_process';
import type { ChildProcessByStdio } from 'node:child_process';
import { statSync } from 'node:fs';
import type { Socket } from 'node:net';
import type { Readable, Writable } from 'node:stream';

import type { Logger } from '#x/log/create-logger.ts';
import { err } from '#x/result/err.ts';
import { ok } from '#x/result/ok.ts';
import type { Result } from '#x/result/result.ts';
import { tailOf } from '#x/text/tail-of.ts';

import { execGit } from './exec-git.ts';
import type { GitError } from './git-error.ts';
import { gitHardeningArgs } from './git-hardening-args.ts';
import type { ObjectReads } from './git-runner.ts';
import { hardenedGitEnvironment } from './hardened-git-environment.ts';
import { isObjectId } from './is-object-id.ts';
import type {
  ObjectContent,
  ObjectInfo,
  ObjectLookup,
  ObjectReadOptions,
  ObjectSpec,
  ObjectType,
} from './object-spec.ts';
import { parseRevisionName } from './parse-revision-name.ts';
import { parseTreePath } from './parse-tree-path.ts';

export interface GitObjectReaderOptions {
  /** The repository's top level (absolute); cat-file runs there. */
  readonly root: string;
  readonly gitBinary?: string;
  /** Stop the process after this long without a request. Defaults to 30 s; zero stops it as soon as it is idle. */
  readonly idleTimeout?: Temporal.Duration;
  /** A request at the head of the queue unanswered after this long restarts the process. Defaults to 30 s. */
  readonly requestTimeout?: Temporal.Duration;
  /** Content `read` accepts when the caller gives no `maxBytes`. Defaults to 64 MiB. */
  readonly maxObjectBytes?: number;
  /** Bytes still owed to abandoned requests past which a restart is cheaper than draining. Defaults to 64 MiB. */
  readonly maxDrainBytes?: number;
  readonly logger?: Logger;
}

/** How often the process was started and restarted, and whether it runs now: for tests and logs. */
export interface ObjectReaderStats {
  readonly starts: number;
  readonly restarts: number;
  readonly isRunning: boolean;
}

/** What a request resolves to before `read` and `info` narrow it. */
type Answer = ObjectLookup | ObjectContent;

interface Pending {
  readonly command: 'info' | 'contents';
  /** The spec as cat-file reads it: validated, one line. */
  readonly line: string;
  /** For `contents`: what the `info` before it found, which the header must repeat. */
  readonly expected: ObjectInfo | undefined;
  readonly settle: (result: Result<Answer, GitError>) => void;
  isSent: boolean;
  /** Answered `aborted` already; its response, if one is owed, is skipped. */
  isAbandoned: boolean;
  /** Resent once after a crash; a second crash fails it. */
  isRetried: boolean;
}

interface Body {
  readonly pending: Pending;
  readonly info: ObjectInfo;
  /** False for an abandoned request: its bytes are counted, not kept. */
  readonly isKept: boolean;
  readonly parts: Buffer[];
  received: number;
  lastByte: number | undefined;
}

type CatFile = ChildProcessByStdio<Writable, Readable, Readable>;

const readerArgs = ['cat-file', '--batch-command', '--buffer'];
const defaultIdleTimeout = Temporal.Duration.from({ seconds: 30 });
const defaultRequestTimeout = Temporal.Duration.from({ seconds: 30 });
const defaultMaxObjectBytes = 64 * 1024 * 1024;
const defaultMaxDrainBytes = 64 * 1024 * 1024;
const exitGrace = Temporal.Duration.from({ seconds: 5 });
const maxStderrChars = 4096;
const newline = 0x0a;
const objectTypes: ReadonlySet<string> = new Set(['blob', 'tree', 'commit', 'tag']);

/**
 * Reads git objects through one lazily started `git cat-file --batch-command --buffer` for a
 * repository root (ADR 0087). Requests are pipelined in FIFO order, flushed once per microtask,
 * and answered by byte count (`<oid> <type> <size>\n<content>\n`), so content is binary-safe.
 * `read` asks `info` first and fetches content by object id only within its cap, so an oversized
 * object never crosses the pipe. Specs are structural ({@link ObjectSpec}) and validated, since
 * one bad line (`<rev>:../x`, `@{99}`) makes cat-file exit and fails the whole queue.
 *
 * An aborted request answers `aborted` at once; bytes still owed to it are skipped as they
 * arrive. The process is restarted only when it exits or answers garbage (requests in flight are
 * resent once), when the request at the head of the queue is unanswered past `requestTimeout`
 * (that one fails with `timeout`), or when abandoned requests owe more than `maxDrainBytes`. It
 * runs with `execGit`'s hardening and environment and is only ever stopped by closing its input
 * or with SIGTERM; it is unreferenced while idle, stops after `idleTimeout`, and
 * `Symbol.asyncDispose` stops it for good. Never rejects. Every request is a `read` (ADR 0079).
 */
export class GitObjectReader implements ObjectReads, AsyncDisposable {
  readonly #root: string;
  readonly #gitBinary: string;
  readonly #idleTimeout: Temporal.Duration;
  readonly #requestTimeout: Temporal.Duration;
  readonly #maxObjectBytes: number;
  readonly #maxDrainBytes: number;
  readonly #logger: Logger | undefined;
  #queue: Pending[] = [];
  #child: CatFile | undefined;
  #stderr = '';
  #header: Buffer[] = [];
  #body: Body | undefined;
  #isFlushScheduled = false;
  #isDisposed = false;
  #watchdog: NodeJS.Timeout | undefined;
  #idle: NodeJS.Timeout | undefined;
  #starts = 0;
  #restarts = 0;
  readonly #exits = new Set<Promise<void>>();
  /**
   * The repository's `packed-refs` (in the common directory), found once by `rev-parse
   * --git-path` before the first request; `undefined` if git couldn't say.
   */
  #packedRefs: Promise<string | undefined> | undefined;
  #packedRefsPath: string | undefined;
  #isPackedRefsFound = false;
  /** `packed-refs`'s identity when the running process was last sent requests. */
  #packedRefsSeen: string | undefined;

  constructor(options: GitObjectReaderOptions) {
    this.#root = options.root;
    this.#gitBinary = options.gitBinary ?? 'git';
    this.#idleTimeout = options.idleTimeout ?? defaultIdleTimeout;
    this.#requestTimeout = options.requestTimeout ?? defaultRequestTimeout;
    this.#maxObjectBytes = options.maxObjectBytes ?? defaultMaxObjectBytes;
    this.#maxDrainBytes = options.maxDrainBytes ?? defaultMaxDrainBytes;
    this.#logger = options.logger;
  }

  async #request<T extends Answer>(
    { command, line, expected }: Pick<Pending, 'command' | 'line' | 'expected'>,
    signal: AbortSignal | undefined,
  ): Promise<Result<T, GitError>> {
    if (this.#isGone(signal)) {
      return err(aborted());
    }
    if (!this.#isPackedRefsFound) {
      this.#packedRefs ??= this.#findPackedRefs();
      this.#packedRefsPath = await this.#packedRefs;
      this.#isPackedRefsFound = true;
      if (this.#isGone(signal)) {
        return err(aborted());
      }
    }
    const answered = Promise.withResolvers<Result<T, GitError>>();
    const pending: Pending = {
      command,
      line,
      expected,
      settle: (result): void => {
        answered.resolve(result as Result<T, GitError>);
      },
      isSent: false,
      isAbandoned: false,
      isRetried: false,
    };
    using listening = new DisposableStack();
    const onAbort = (): void => {
      this.#cancel(pending);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    listening.defer(() => {
      signal?.removeEventListener('abort', onAbort);
    });
    this.#queue.push(pending);
    this.#scheduleFlush();
    return await answered.promise;
  }

  #isGone(signal: AbortSignal | undefined): boolean {
    return this.#isDisposed || signal?.aborted === true;
  }

  #cancel(pending: Pending): void {
    if (pending.isAbandoned) {
      return;
    }
    this.#abandon(pending);
    if (!pending.isSent) {
      this.#queue = this.#queue.filter((queued) => queued !== pending);
      this.#settleIdle();
      return;
    }
    if (this.#owedBytes() > this.#maxDrainBytes) {
      this.#restart('drain', 'abandoned requests owe too many bytes');
    }
  }

  #abandon(pending: Pending): void {
    if (pending.isAbandoned) {
      return;
    }

    pending.isAbandoned = true;
    pending.settle(err(aborted()));
  }

  #owedBytes(): number {
    let owed = 0;
    for (const pending of this.#queue) {
      if (!pending.isAbandoned || pending.expected === undefined) {
        continue;
      }
      if (this.#body?.pending === pending) {
        owed += this.#body.info.size + 1 - this.#body.received;
      } else {
        owed += pending.expected.size + 1;
      }
    }
    return owed;
  }

  #scheduleFlush(): void {
    clearTimeout(this.#idle);
    this.#idle = undefined;
    if (this.#isFlushScheduled) {
      return;
    }
    this.#isFlushScheduled = true;
    queueMicrotask(() => {
      this.#isFlushScheduled = false;
      this.#flush();
    });
  }

  #flush(): void {
    if (this.#isDisposed || this.#queue.every((pending) => pending.isSent)) {
      return;
    }
    const packedRefs = this.#packedRefsIdentity();
    if (this.#child !== undefined && packedRefs !== this.#packedRefsSeen) {
      this.#retire();
    }
    const child = this.#child ?? this.#start();
    this.#packedRefsSeen = packedRefs;
    const unsent = this.#queue.filter((pending) => !pending.isSent);
    setReferenced(child, true);
    for (const pending of unsent) {
      pending.isSent = true;
    }
    child.stdin.write(
      `${unsent.map((pending) => `${pending.command} ${pending.line}\n`).join('')}flush\n`,
    );
    this.#watchdog ??= this.#armWatchdog();
  }

  /**
   * Where `packed-refs` is. A long-lived git keeps its parsed `packed-refs` until the file's stat
   * data changes, and misses a rewrite of the same size in the same second (`git pack-refs` after
   * updating a packed ref), answering the old value from then on; the reader checks the file
   * itself before each write instead (see {@link #packedRefsIdentity}).
   */
  async #findPackedRefs(): Promise<string | undefined> {
    const found = await execGit({
      cwd: this.#root,
      args: ['rev-parse', '--path-format=absolute', '--git-path', 'packed-refs'],
      gitBinary: this.#gitBinary,
      timeout: this.#requestTimeout,
      policy: { kind: 'read' },
      ...(this.#logger !== undefined && { logger: this.#logger }),
    });
    if (!found.ok) {
      return undefined;
    }
    return found.value.toString('utf8').trim() || undefined;
  }

  /**
   * `packed-refs`'s inode, size and nanosecond times, or `absent` (the reftable backend has
   * none, and the files backend may not yet). A change since the running process was last sent
   * requests means it may hold the old refs, so the next requests go to a fresh process.
   */
  #packedRefsIdentity(): string {
    if (this.#packedRefsPath === undefined) {
      return 'unknown';
    }
    try {
      const stats = statSync(this.#packedRefsPath, { bigint: true, throwIfNoEntry: false });
      if (stats === undefined) {
        return 'absent';
      }
      return [stats.dev, stats.ino, stats.size, stats.mtimeNs, stats.ctimeNs].join(':');
    } catch {
      return 'unknown';
    }
  }

  /**
   * Hands everything still wanted to a fresh process after `packed-refs` changed: the old one
   * answers nothing more and is stopped with SIGTERM. Not a restart; nothing went wrong.
   */
  #retire(): void {
    const child = this.#child;
    this.#detach();
    this.#queue = this.#queue.filter((pending) => !pending.isAbandoned);
    for (const pending of this.#queue) {
      pending.isSent = false;
    }
    this.#logger?.debug('git cat-file refreshed: packed-refs changed', { cwd: this.#root });
    child?.kill('SIGTERM');
  }

  #start(): CatFile {
    this.#starts += 1;
    this.#stderr = '';
    this.#header = [];
    this.#body = undefined;
    const child: CatFile = spawn(this.#gitBinary, [...gitHardeningArgs, ...readerArgs], {
      cwd: this.#root,
      env: hardenedGitEnvironment(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
    this.#child = child;
    const exited = Promise.withResolvers<undefined>();
    const onGone = (): void => {
      this.#exits.delete(exited.promise);
      exited.resolve(undefined);
    };
    child.once('close', onGone);
    child.once('error', onGone);
    this.#exits.add(exited.promise);
    child.stdin.on('error', ignoreBrokenPipe);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      this.#stderr = tailOf(this.#stderr + chunk, maxStderrChars);
    });
    child.stdout.on('data', (chunk: Buffer) => {
      if (this.#child === child) {
        this.#receive(chunk);
      }
    });
    child.once('error', (error: NodeJS.ErrnoException) => {
      if (this.#child === child) {
        if (error.code === 'ENOENT') {
          this.#failAll({ kind: 'git-not-found', gitBinary: this.#gitBinary });
        } else {
          this.#failAll(this.#failure(undefined, undefined, error.message));
        }
      }
    });
    child.once('exit', (code, signal) => {
      if (this.#child === child) {
        this.#crashed(this.#failure(code ?? undefined, signal ?? undefined, this.#stderr.trim()));
      }
    });
    this.#logger?.debug('git cat-file started', { cwd: this.#root, starts: this.#starts });
    return child;
  }

  #receive(chunk: Buffer): void {
    let offset = 0;
    while (offset < chunk.length && this.#child !== undefined) {
      const body = this.#body;
      if (body !== undefined) {
        offset = this.#receiveBody(body, chunk, offset);
        continue;
      }
      const end = chunk.indexOf(newline, offset);
      if (end === -1) {
        this.#header.push(chunk.subarray(offset));
        return;
      }
      this.#header.push(chunk.subarray(offset, end));
      offset = end + 1;
      const line = Buffer.concat(this.#header).toString('utf8');
      this.#header = [];
      this.#answerHeader(line);
    }
  }

  #receiveBody(body: Body, chunk: Buffer, offset: number): number {
    const take = Math.min(body.info.size + 1 - body.received, chunk.length - offset);
    const part = chunk.subarray(offset, offset + take);
    if (body.isKept) {
      body.parts.push(part);
    }
    body.received += take;
    body.lastByte = part.at(-1) ?? body.lastByte;
    if (body.received === body.info.size + 1) {
      this.#body = undefined;
      if (body.lastByte !== newline) {
        this.#restart('crash', 'an object was not followed by a newline');
        return offset + take;
      }
      const bytes = Buffer.concat(body.parts).subarray(0, body.info.size);
      this.#answered(body.pending, ok({ kind: 'content', ...body.info, bytes }));
    }
    return offset + take;
  }

  #answerHeader(line: string): void {
    const pending = this.#queue[0];
    if (pending?.isSent !== true) {
      this.#restart('crash', `unexpected output: ${JSON.stringify(line.slice(0, 80))}`);
      return;
    }
    if (line === `${pending.line} missing`) {
      this.#answered(pending, ok({ kind: 'missing' }));
      return;
    }
    if (line === `${pending.line} ambiguous`) {
      this.#answered(pending, ok({ kind: 'ambiguous' }));
      return;
    }
    const info = infoFrom(line);
    const expected = pending.expected;
    if (
      info === undefined ||
      (expected !== undefined && (info.oid !== expected.oid || info.size !== expected.size))
    ) {
      this.#restart('crash', `unexpected header: ${JSON.stringify(line.slice(0, 80))}`);
      return;
    }
    if (pending.command === 'info') {
      this.#answered(pending, ok({ kind: 'found', ...info }));
      return;
    }
    this.#body = {
      pending,
      info,
      isKept: !pending.isAbandoned,
      parts: [],
      received: 0,
      lastByte: undefined,
    };
  }

  #answered(pending: Pending, result: Result<Answer, GitError>): void {
    this.#queue.shift();
    if (!pending.isAbandoned) {
      pending.settle(result);
    }
    clearTimeout(this.#watchdog);
    this.#watchdog = undefined;
    if (this.#queue.length > 0) {
      this.#watchdog = this.#armWatchdog();
    }
    this.#settleIdle();
  }

  #armWatchdog(): NodeJS.Timeout {
    const timer = setTimeout(() => {
      this.#watchdog = undefined;
      const head = this.#queue[0];
      if (head !== undefined && !head.isAbandoned) {
        head.isAbandoned = true;
        head.settle(err({ kind: 'timeout', args: readerArgs, timeout: this.#requestTimeout }));
      }
      this.#restart('timeout', 'the request at the head of the queue timed out');
    }, this.#requestTimeout.total('milliseconds'));
    timer.unref();
    return timer;
  }

  /** Idle: unreferenced so it never keeps the app alive, and stopped after `idleTimeout`. */
  #settleIdle(): void {
    if (this.#queue.length > 0 || this.#child === undefined) {
      return;
    }
    setReferenced(this.#child, false);
    clearTimeout(this.#idle);
    this.#idle = setTimeout(() => {
      this.#idle = undefined;
      if (this.#queue.length === 0) {
        this.#stop();
      }
    }, this.#idleTimeout.total('milliseconds'));
    this.#idle.unref();
  }

  /** The process exited on its own or answered garbage: requests in flight are resent once. */
  #crashed(failure: GitError): void {
    this.#detach();
    this.#restarts += 1;
    this.#logger?.warn('git cat-file stopped unexpectedly', { cwd: this.#root, failure });
    const survivors: Pending[] = [];
    for (const pending of this.#queue) {
      if (pending.isAbandoned) {
        continue;
      }
      if (pending.isSent && pending.isRetried) {
        pending.isAbandoned = true;
        pending.settle(err(failure));
        continue;
      }
      pending.isRetried ||= pending.isSent;
      pending.isSent = false;
      survivors.push(pending);
    }
    this.#queue = survivors;
    this.#resume();
  }

  /** Stops the process with SIGTERM and resends what is still wanted. */
  #restart(reason: 'crash' | 'timeout' | 'drain', message: string): void {
    const child = this.#child;
    if (reason === 'crash') {
      this.#crashed(this.#failure(undefined, undefined, message));
    } else {
      this.#detach();
      this.#restarts += 1;
      this.#logger?.warn('git cat-file restarted', { cwd: this.#root, reason: message });
      this.#queue = this.#queue.filter((pending) => !pending.isAbandoned);
      for (const pending of this.#queue) {
        pending.isSent = false;
      }
      this.#resume();
    }
    child?.kill('SIGTERM');
  }

  #resume(): void {
    if (this.#queue.length > 0 && !this.#isDisposed) {
      this.#scheduleFlush();
    }
  }

  #failAll(failure: GitError): void {
    this.#detach();
    for (const pending of this.#queue) {
      if (pending.isAbandoned) {
        continue;
      }

      pending.isAbandoned = true;
      pending.settle(err(failure));
    }
    this.#queue = [];
  }

  /** Forgets the current process; its later output and exit are ignored. */
  #detach(): void {
    const child = this.#child;
    this.#child = undefined;
    this.#body = undefined;
    this.#header = [];
    clearTimeout(this.#watchdog);
    this.#watchdog = undefined;
    if (child === undefined) {
      return;
    }

    setReferenced(child, false);
    child.stdout.removeAllListeners('data');
    child.stdout.resume();
  }

  /** Closes the process's input, which makes cat-file exit; SIGTERM if it hasn't after a grace. */
  #stop(): void {
    clearTimeout(this.#idle);
    this.#idle = undefined;
    const child = this.#child;
    this.#detach();
    if (child?.exitCode !== null || child.signalCode !== null) {
      return;
    }
    this.#logger?.debug('git cat-file stopping', { cwd: this.#root });
    const grace = setTimeout(() => {
      child.kill('SIGTERM');
    }, exitGrace.total('milliseconds'));
    grace.unref();
    child.once('close', () => {
      clearTimeout(grace);
    });
    child.stdin.end();
  }

  #failure(exitCode: number | undefined, signal: string | undefined, stderr: string): GitError {
    return { kind: 'command-failed', args: readerArgs, exitCode, signal, stdout: '', stderr };
  }

  get stats(): ObjectReaderStats {
    return { starts: this.#starts, restarts: this.#restarts, isRunning: this.#child !== undefined };
  }

  /** The object's type and size (`info`): no content crosses the pipe. */
  async info(
    spec: ObjectSpec,
    options: Omit<ObjectReadOptions, 'maxBytes'> = {},
  ): Promise<Result<ObjectLookup, GitError>> {
    const line = lineFrom(spec);
    if (line === undefined) {
      return err({
        kind: 'invalid-argument',
        argument: JSON.stringify(spec),
        reason: 'not a valid object spec',
      });
    }
    return this.#request<ObjectLookup>(
      { command: 'info', line, expected: undefined },
      options.signal,
    );
  }

  /** The object's content, or `too-large` past `maxBytes` (then only its `info` was asked). */
  async read(
    spec: ObjectSpec,
    options: ObjectReadOptions = {},
  ): Promise<Result<ObjectContent, GitError>> {
    const maxBytes = options.maxBytes ?? this.#maxObjectBytes;
    const found = await this.info(spec, options);
    if (!found.ok || found.value.kind !== 'found') {
      return found as Result<ObjectContent, GitError>;
    }
    const { oid, type, size } = found.value;
    if (size > maxBytes) {
      return ok({ kind: 'too-large', oid, type, size, limit: maxBytes });
    }
    return this.#request<ObjectContent>(
      { command: 'contents', line: oid, expected: { oid, type, size } },
      options.signal,
    );
  }

  /** Answers every request `aborted`, stops the process and waits until it has exited. */
  async [Symbol.asyncDispose](): Promise<void> {
    this.#isDisposed = true;
    for (const pending of this.#queue) {
      this.#abandon(pending);
    }
    this.#queue = [];
    this.#stop();
    await Promise.all(this.#exits);
  }
}

/** The spec as one cat-file request line, or `undefined` when it isn't valid. */
function lineFrom(spec: ObjectSpec): string | undefined {
  switch (spec.kind) {
    case 'object': {
      if (isObjectId(spec.oid)) {
        return spec.oid;
      }
      return undefined;
    }
    case 'path': {
      if (isObjectId(spec.commit) && parseTreePath(spec.path) !== undefined) {
        return `${spec.commit}:${spec.path}`;
      }
      return undefined;
    }
    case 'ref': {
      if (parseRevisionName(spec.ref) === undefined) {
        return undefined;
      }
      return `${spec.ref}^{${spec.peel}}`;
    }
  }
}

function infoFrom(line: string): ObjectInfo | undefined {
  const [oid = '', type = '', sizeText = '', ...rest] = line.split(' ');
  const size = Number(sizeText);
  if (
    isObjectId(oid) &&
    objectTypes.has(type) &&
    Number.isSafeInteger(size) &&
    size >= 0 &&
    rest.length === 0
  ) {
    return { oid, type: type as ObjectType, size };
  }
  return undefined;
}

function aborted(): GitError {
  return { kind: 'aborted', args: readerArgs };
}

/** A busy process keeps the event loop alive; an idle one must not keep the app from quitting. */
function setReferenced(child: CatFile, isReferenced: boolean): void {
  const handles = [child, child.stdin as Socket, child.stdout as Socket, child.stderr as Socket];
  for (const handle of handles) {
    if (isReferenced) {
      handle.ref();
    } else {
      handle.unref();
    }
  }
}

/** git may exit before reading its input; the exit says why. */
function ignoreBrokenPipe(): void {
  // Reported through `exit` instead.
}
