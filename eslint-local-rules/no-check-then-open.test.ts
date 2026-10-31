import { createRuleTester } from './create-rule-tester.ts';
import { noCheckThenOpen } from './no-check-then-open.ts';

createRuleTester().run('no-check-then-open', noCheckThenOpen, {
  valid: [
    // One open, then questions to the handle.
    "import { open } from 'node:fs/promises'; async function f(file: string): Promise<string> { await using handle = await open(file, 'r'); const stats = await handle.stat(); return stats.isFile() ? await handle.readFile('utf8') : ''; }",
    // A check alone, or a check of one path and an open of another.
    "import { stat } from 'node:fs/promises'; async function f(file: string): Promise<boolean> { return (await stat(file)).isFile(); }",
    "import { readFile, realpath } from 'node:fs/promises'; async function f(file: string): Promise<string> { const real = await realpath(file); return readFile(real, 'utf8'); }",
    // The open comes first.
    "import { readFile, stat } from 'node:fs/promises'; async function f(file: string): Promise<number> { await readFile(file); return (await stat(file)).size; }",
    // The check and the open are in different functions.
    "import { readFile, stat } from 'node:fs/promises'; async function f(file: string): Promise<boolean> { return (await stat(file)).isFile(); } async function g(file: string): Promise<string> { return readFile(file, 'utf8'); }",
    "import { readFile, stat } from 'node:fs/promises'; async function f(file: string): Promise<void> { await stat(file); const later = async (): Promise<string> => readFile(file, 'utf8'); await later(); }",
    // Functions of the same name that are not node:fs's.
    "import { stat, readFile } from './store.ts'; async function f(file: string): Promise<void> { await stat(file); await readFile(file); }",
    // Spawning a checked executable is not an open.
    "import { access } from 'node:fs/promises'; import { spawn } from 'node:child_process'; async function f(file: string): Promise<void> { await access(file); spawn(file); }",
  ],
  invalid: [
    {
      code: "import { readFile, stat } from 'node:fs/promises'; async function f(file: string): Promise<string> { const stats = await stat(file); return stats.size > 10 ? '' : await readFile(file, 'utf8'); }",
      errors: [
        { messageId: 'checkThenOpen', data: { use: 'readFile', check: 'stat', path: 'file' } },
      ],
    },
    {
      code: "import { existsSync, readFileSync } from 'node:fs'; function f(file: string): string { return existsSync(file) ? readFileSync(file, 'utf8') : ''; }",
      errors: [{ messageId: 'checkThenOpen' }],
    },
    {
      code: "import fs from 'node:fs'; function f(file: string): void { if (fs.existsSync(file)) { fs.rmSync(file); } }",
      errors: [{ messageId: 'checkThenOpen' }],
    },
    {
      code: "import * as fs from 'node:fs'; async function f(file: string): Promise<void> { await fs.promises.lstat(file); await fs.promises.writeFile(file, 'x'); }",
      errors: [{ messageId: 'checkThenOpen' }],
    },
    {
      code: "import { open as openFile, stat as statFile } from 'node:fs/promises'; const f = async (file: string): Promise<void> => { if ((await statFile(file)).isFile()) { await using handle = await openFile(file, 'r'); } };",
      errors: [{ messageId: 'checkThenOpen', data: { use: 'open', check: 'stat', path: 'file' } }],
    },
  ],
});
