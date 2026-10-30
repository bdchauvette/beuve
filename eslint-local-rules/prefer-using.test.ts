import { preferUsing } from './prefer-using.ts';
import { createTypedRuleTester } from './testing/create-typed-rule-tester.ts';

createTypedRuleTester('node-fixture').run('prefer-using', preferUsing, {
  valid: [
    // Bookkeeping stays in `finally` (ADR 0076).
    'declare const inFlight: Map<string, number>; async function f(key: string): Promise<void> { try { await g(); } finally { inFlight.delete(key); } } declare function g(): Promise<void>;',
    'let running = 0; async function f(): Promise<void> { try { running += 1; await g(); } finally { running -= 1; } } declare function g(): Promise<void>;',
    'declare function pump(): void; async function f(): Promise<void> { try { await g(); } finally { pump(); } } declare function g(): Promise<void>;',
    // A release next to bookkeeping is left alone.
    'declare const jobs: Map<string, number>; declare const timer: NodeJS.Timeout; function f(key: string): void { try { g(); } finally { clearTimeout(timer); jobs.delete(key); } } declare function g(): void;',
    // A conditional release.
    'declare const handle: { close(): void } | undefined; function f(): void { try { g(); } finally { if (handle !== undefined) { handle.close(); } } } declare function g(): void;',
    'function f(): void { try { g(); } catch { h(); } } declare function g(): void; declare function h(): void;',
    // Already `using`.
    "import { open } from 'node:fs/promises'; async function f(): Promise<number> { await using handle = await open('a'); return (await handle.stat()).size; }",
    // A disposable that is returned, stored, passed on or captured outlives the scope.
    "import { open, type FileHandle } from 'node:fs/promises'; async function f(): Promise<FileHandle> { const handle = await open('a'); return handle; }",
    "import { open, type FileHandle } from 'node:fs/promises'; const handles: FileHandle[] = []; async function f(): Promise<void> { const handle = await open('a'); handles.push(handle); await handle.close(); }",
    "import { open } from 'node:fs/promises'; async function f(): Promise<() => Promise<void>> { const handle = await open('a'); await handle.stat(); return async () => handle.close(); }",
    // A disposable never freed by hand: its owner is elsewhere.
    "import { spawn } from 'node:child_process'; function f(): void { const child = spawn('true'); child.kill('SIGKILL'); }",
    // Not disposable.
    'function f(): void { const resource = { close(): void {} }; resource.close(); }',
    'function f(map: Map<string, number>): void { const copy = new Map(map); copy.delete("a"); }',
  ],
  invalid: [
    {
      code: "import { open } from 'node:fs/promises'; async function f(): Promise<void> { const handle = await open('a'); try { await handle.stat(); } finally { await handle.close(); } }",
      errors: [
        { messageId: 'releasedByHand', data: { name: 'handle', keyword: 'await using' } },
        { messageId: 'finallyOnlyReleases' },
      ],
    },
    {
      code: "function f(signal: AbortSignal): void { const timer = setTimeout(() => {}, 5); const onAbort = (): void => {}; signal.addEventListener('abort', onAbort); try { g(); } finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); } } declare function g(): void;",
      errors: [
        { messageId: 'releasedByHand', data: { name: 'timer', keyword: 'using' } },
        { messageId: 'finallyOnlyReleases' },
      ],
    },
    {
      // Through optional chaining, `void` and an argument-less `delete()`.
      code: 'declare const tree: { delete(): void }; declare const conversation: { close(): void } | undefined; declare const server: { dispose(): Promise<void> }; async function f(): Promise<void> { try { await g(); } catch { h(); } finally { tree.delete(); conversation?.close(); void server.dispose(); } } declare function g(): Promise<void>; declare function h(): void;',
      errors: [{ messageId: 'finallyOnlyReleases' }],
    },
    {
      code: "import { rm } from 'node:fs/promises'; async function f(directory: string): Promise<void> { try { await g(directory); } finally { await rm(directory, { recursive: true, force: true }); } } declare function g(directory: string): Promise<void>;",
      errors: [{ messageId: 'finallyOnlyReleases' }],
    },
    {
      code: 'declare const resource: Disposable; function f(): void { try { g(); } finally { resource[Symbol.dispose](); } } declare function g(): void;',
      errors: [{ messageId: 'finallyOnlyReleases' }],
    },
    {
      // Freed without a `finally`: an early return or a throw would skip it.
      code: "import { DatabaseSync } from 'node:sqlite'; function f(): number { const db = new DatabaseSync(':memory:'); const count = db.prepare('select 1').all().length; db.close(); return count; }",
      errors: [{ messageId: 'releasedByHand', data: { name: 'db', keyword: 'using' } }],
    },
    {
      code: "import { mkdtempDisposable } from 'node:fs/promises'; async function f(): Promise<string> { const directory = await mkdtempDisposable('x-'); const { path } = { path: directory.path }; await directory.remove(); return path; }",
      errors: [
        { messageId: 'releasedByHand', data: { name: 'directory', keyword: 'await using' } },
      ],
    },
  ],
});
