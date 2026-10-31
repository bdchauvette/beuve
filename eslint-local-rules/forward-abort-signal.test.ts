import { forwardAbortSignal } from './forward-abort-signal.ts';
import { createTypedRuleTester } from './testing/create-typed-rule-tester.ts';

createTypedRuleTester('node-fixture').run('forward-abort-signal', forwardAbortSignal, {
  valid: [
    // No signal in scope.
    "async function f(): Promise<Response> { return fetch('x'); }",
    // Forwarded, as an option and as a parameter.
    "async function f(signal: AbortSignal): Promise<Response> { return fetch('x', { signal }); }",
    'declare function wait(ms: number, signal?: AbortSignal): Promise<void>; async function f(signal: AbortSignal): Promise<void> { await wait(5, signal); }',
    // An options bag that is not a literal may carry it.
    "declare const init: RequestInit; async function f(signal: AbortSignal): Promise<Response> { void signal; return fetch('x', init); }",
    "function f(options: { readonly signal?: AbortSignal }): Promise<Response> { return fetch('x', { ...options }); }",
    // A value whose type has a `signal` carries one.
    'async function f(request: Request): Promise<Response> { return fetch(request); }',
    // Module-level signals never count.
    "const controller = new AbortController(); void fetch('x');",
    // A signal's own listeners would be removed before they run.
    "function f(signal: AbortSignal): void { signal.addEventListener('abort', () => {}, { once: true }); }",
    // `…Sync` functions ignore their signal.
    "import { writeFileSync } from 'node:fs'; function f(signal: AbortSignal): void { void signal; writeFileSync('a', 'b'); }",
    // The signal is already an argument.
    "import { once } from 'node:events'; async function f(signal: AbortSignal): Promise<unknown> { return once(signal, 'abort'); }",
    // A derived signal replaces the one it derives from.
    "async function f(signal: AbortSignal): Promise<Response> { const bounded = AbortSignal.any([signal, AbortSignal.timeout(5)]); return fetch('x', { signal: bounded }); }",
    // A controller declared after the call.
    "async function f(): Promise<void> { await fetch('x'); const controller = new AbortController(); controller.abort(); }",
    // A field the method does not read.
    "class A { private readonly controller = new AbortController(); go(): Promise<Response> { return fetch('x'); } stop(): void { this.controller.abort(); } }",
    // A signal variable being reassigned is not in scope for its own new value.
    "function f(): AbortSignal { const request = new Request('x'); const deadline = AbortSignal.timeout(5); let stopped = deadline; if (request.keepalive) { stopped = AbortSignal.any([request.signal, deadline]); } return stopped; }",
    // Nor for its initializer.
    'function f(): AbortSignal { const deadline = AbortSignal.timeout(5); const stopped: AbortSignal = AbortSignal.any([deadline]); return stopped; }',
    // A callee that takes no signal.
    'function f(signal: AbortSignal): string { void signal; return JSON.stringify({}); }',
  ],
  invalid: [
    {
      code: "async function f(signal: AbortSignal): Promise<Response> { return fetch('x'); }",
      errors: [{ messageId: 'forward', data: { callee: 'fetch', signal: 'signal' } }],
      output:
        "async function f(signal: AbortSignal): Promise<Response> { return fetch('x', { signal }); }",
    },
    {
      code: "async function f(signal: AbortSignal): Promise<Response> { return fetch('x', { method: 'POST' }); }",
      errors: [{ messageId: 'forward' }],
      output:
        "async function f(signal: AbortSignal): Promise<Response> { return fetch('x', { method: 'POST', signal }); }",
    },
    {
      code: "function f(signal: AbortSignal): Request { return new Request('x'); }",
      errors: [{ messageId: 'forward', data: { callee: 'Request', signal: 'signal' } }],
      output: "function f(signal: AbortSignal): Request { return new Request('x', { signal }); }",
    },
    {
      // An options-bag parameter.
      code: 'function f(url: string, options: { readonly signal?: AbortSignal } = {}): Promise<Response> { return fetch(url, {}); }',
      errors: [{ messageId: 'forward', data: { callee: 'fetch', signal: 'options.signal' } }],
      output:
        'function f(url: string, options: { readonly signal?: AbortSignal } = {}): Promise<Response> { return fetch(url, { signal: options.signal }); }',
    },
    {
      // A destructured option.
      code: "async function f({ signal }: { readonly signal: AbortSignal }): Promise<Response> { return fetch('x'); }",
      errors: [{ messageId: 'forward' }],
      output:
        "async function f({ signal }: { readonly signal: AbortSignal }): Promise<Response> { return fetch('x', { signal }); }",
    },
    {
      // A local controller and `addEventListener`.
      code: "function f(target: EventTarget): AbortController { const controller = new AbortController(); target.addEventListener('x', () => {}); return controller; }",
      errors: [
        {
          messageId: 'forward',
          data: { callee: 'target.addEventListener', signal: 'controller.signal' },
        },
      ],
      output:
        "function f(target: EventTarget): AbortController { const controller = new AbortController(); target.addEventListener('x', () => {}, { signal: controller.signal }); return controller; }",
    },
    {
      // `setTimeout` from `node:timers/promises`: the skipped `value` is filled in.
      code: "import { setTimeout as sleep } from 'node:timers/promises'; async function f(signal: AbortSignal): Promise<void> { await sleep(10); }",
      errors: [{ messageId: 'forward', data: { callee: 'sleep', signal: 'signal' } }],
      output:
        "import { setTimeout as sleep } from 'node:timers/promises'; async function f(signal: AbortSignal): Promise<void> { await sleep(10, undefined, { signal }); }",
    },
    {
      code: "import { once } from 'node:events'; import type { EventEmitter } from 'node:events'; async function f(emitter: EventEmitter, signal: AbortSignal): Promise<unknown> { return once(emitter, 'x'); }",
      errors: [{ messageId: 'forward', data: { callee: 'once', signal: 'signal' } }],
      output:
        "import { once } from 'node:events'; import type { EventEmitter } from 'node:events'; async function f(emitter: EventEmitter, signal: AbortSignal): Promise<unknown> { return once(emitter, 'x', { signal }); }",
    },
    {
      code: "import { spawn } from 'node:child_process'; function f(signal: AbortSignal): unknown { return spawn('git', ['status'], { cwd: '/' }); }",
      errors: [{ messageId: 'forward', data: { callee: 'spawn', signal: 'signal' } }],
      output:
        "import { spawn } from 'node:child_process'; function f(signal: AbortSignal): unknown { return spawn('git', ['status'], { cwd: '/', signal }); }",
    },
    {
      code: "import { execFile } from 'node:child_process'; import { promisify } from 'node:util'; async function f(signal: AbortSignal): Promise<unknown> { return promisify(execFile)('git', ['status'], { encoding: 'utf8' }); }",
      errors: [{ messageId: 'forward' }],
      output:
        "import { execFile } from 'node:child_process'; import { promisify } from 'node:util'; async function f(signal: AbortSignal): Promise<unknown> { return promisify(execFile)('git', ['status'], { encoding: 'utf8', signal }); }",
    },
    {
      code: 'async function f(source: ReadableStream<string>, sink: WritableStream<string>, signal: AbortSignal): Promise<void> { await source.pipeTo(sink); }',
      errors: [{ messageId: 'forward', data: { callee: 'source.pipeTo', signal: 'signal' } }],
      output:
        'async function f(source: ReadableStream<string>, sink: WritableStream<string>, signal: AbortSignal): Promise<void> { await source.pipeTo(sink, { signal }); }',
    },
    {
      code: 'function f(source: ReadableStream<string>, signal: AbortSignal): ReadableStream<string> { return source.pipeThrough(new TransformStream<string, string>()); }',
      errors: [{ messageId: 'forward', data: { callee: 'source.pipeThrough', signal: 'signal' } }],
      output:
        'function f(source: ReadableStream<string>, signal: AbortSignal): ReadableStream<string> { return source.pipeThrough(new TransformStream<string, string>(), { signal }); }',
    },
    {
      code: 'function f(signal: AbortSignal): AbortSignal { return AbortSignal.any([AbortSignal.timeout(5)]); }',
      errors: [{ messageId: 'forward', data: { callee: 'AbortSignal.any', signal: 'signal' } }],
      output:
        'function f(signal: AbortSignal): AbortSignal { return AbortSignal.any([AbortSignal.timeout(5), signal]); }',
    },
    {
      // A reassigned signal variable is not offered for its own new value: the signal it derives from is.
      code: 'function f(): AbortSignal { const deadline = AbortSignal.timeout(5); let stopped = deadline; stopped = AbortSignal.any([AbortSignal.timeout(9)]); return stopped; }',
      errors: [{ messageId: 'forward', data: { callee: 'AbortSignal.any', signal: 'deadline' } }],
      output:
        'function f(): AbortSignal { const deadline = AbortSignal.timeout(5); let stopped = deadline; stopped = AbortSignal.any([AbortSignal.timeout(9), deadline]); return stopped; }',
    },
    {
      // Our own function, with a signal parameter.
      code: 'declare function wait(ms: number, signal?: AbortSignal): Promise<void>; async function f(signal: AbortSignal): Promise<void> { await wait(5); }',
      errors: [{ messageId: 'forward', data: { callee: 'wait', signal: 'signal' } }],
      output:
        'declare function wait(ms: number, signal?: AbortSignal): Promise<void>; async function f(signal: AbortSignal): Promise<void> { await wait(5, signal); }',
    },
    {
      // The Vitest test context's signal, destructured by the fix.
      code: "declare function load(path: string, options?: { readonly signal?: AbortSignal | undefined }): Promise<string>; declare function test(name: string, fn: (context: { readonly expect: unknown; readonly signal: AbortSignal }) => Promise<void>): void; test('loads', async ({ expect }) => { void expect; await load('a'); });",
      errors: [{ messageId: 'forward', data: { callee: 'load', signal: 'signal' } }],
      output:
        "declare function load(path: string, options?: { readonly signal?: AbortSignal | undefined }): Promise<string>; declare function test(name: string, fn: (context: { readonly expect: unknown; readonly signal: AbortSignal }) => Promise<void>): void; test('loads', async ({ expect, signal }) => { void expect; await load('a', { signal }); });",
    },
    {
      code: "declare function test(name: string, fn: (context: { readonly signal: AbortSignal }) => Promise<void>): void; test('fetches', async ({}) => { await fetch('x'); });",
      errors: [{ messageId: 'forward' }],
      output:
        "declare function test(name: string, fn: (context: { readonly signal: AbortSignal }) => Promise<void>): void; test('fetches', async ({ signal }) => { await fetch('x', { signal }); });",
    },
    {
      // A nested callback forwards the test's signal.
      code: "declare function test(name: string, fn: (context: { readonly signal: AbortSignal }) => Promise<void>): void; test('fetches', async (context) => { await Promise.all(['a'].map(async (url) => fetch(url))); });",
      errors: [{ messageId: 'forward', data: { callee: 'fetch', signal: 'context.signal' } }],
      output:
        "declare function test(name: string, fn: (context: { readonly signal: AbortSignal }) => Promise<void>): void; test('fetches', async (context) => { await Promise.all(['a'].map(async (url) => fetch(url, { signal: context.signal }))); });",
    },
    {
      // A field signal the method reads.
      code: "class A { readonly #signal: AbortSignal; constructor(signal: AbortSignal) { this.#signal = signal; } start(): Promise<Response> { void this.#signal; return fetch('x'); } }",
      errors: [{ messageId: 'forward', data: { callee: 'fetch', signal: 'this.#signal' } }],
      output:
        "class A { readonly #signal: AbortSignal; constructor(signal: AbortSignal) { this.#signal = signal; } start(): Promise<Response> { void this.#signal; return fetch('x', { signal: this.#signal }); } }",
    },
    {
      // A controller field whose signal the method reads (ActionDelegation, ADR 0074).
      code: "class A { private controller: AbortController | undefined; connect(target: EventTarget): void { this.controller = new AbortController(); target.addEventListener('a', () => {}, { signal: this.controller.signal }); target.addEventListener('b', () => {}); } }",
      errors: [
        {
          messageId: 'forward',
          data: { callee: 'target.addEventListener', signal: 'this.controller?.signal' },
        },
      ],
      output:
        "class A { private controller: AbortController | undefined; connect(target: EventTarget): void { this.controller = new AbortController(); target.addEventListener('a', () => {}, { signal: this.controller.signal }); target.addEventListener('b', () => {}, { signal: this.controller?.signal }); } }",
    },
    {
      // The nearest function's signal wins.
      code: "function outer(signal: AbortSignal): (inner: AbortSignal) => Promise<Response> { void signal; return async (inner) => fetch('x'); }",
      errors: [{ messageId: 'forward', data: { callee: 'fetch', signal: 'inner' } }],
      output:
        "function outer(signal: AbortSignal): (inner: AbortSignal) => Promise<Response> { void signal; return async (inner) => fetch('x', { signal: inner }); }",
    },
    {
      // Two signals: reported, not fixed.
      code: "function f(signal: AbortSignal): Promise<Response> { const controller = new AbortController(); void [signal, controller]; return fetch('x'); }",
      errors: [
        {
          messageId: 'forwardOneOf',
          data: { callee: 'fetch', signals: '`signal`, `controller.signal`' },
        },
      ],
    },
    {
      // An existing options literal gains the signal after its properties.
      code: "import { setTimeout as sleep } from 'node:timers/promises'; declare const value: string; async function f(signal: AbortSignal): Promise<string> { return sleep(10, value, { ref: false }); }",
      errors: [{ messageId: 'forward' }],
      output:
        "import { setTimeout as sleep } from 'node:timers/promises'; declare const value: string; async function f(signal: AbortSignal): Promise<string> { return sleep(10, value, { ref: false, signal }); }",
    },
    {
      // A non-object option (`capture`): reported, not fixed.
      code: "function f(target: EventTarget, signal: AbortSignal): void { target.addEventListener('x', () => {}, true); }",
      errors: [{ messageId: 'forward' }],
    },
  ],
});
