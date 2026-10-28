import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** A throwaway TypeScript project on disk for language-server integration tests. */
export interface TypescriptProject {
  /** Real path of the project root. */
  readonly root: string;
  /** Writes a file relative to the root, creating parent directories. */
  readonly write: (file: string, content: string) => void;
  readonly cleanup: () => void;
}

/** Creates the project in a new temporary directory. */
export function createTypescriptProject(): TypescriptProject {
  const created = mkdtempSync(path.join(os.tmpdir(), 'beuve-lsp-'));
  const root = realpathSync(created);
  const write = (file: string, content: string): void => {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  for (const [file, content] of Object.entries(typescriptProjectFiles)) {
    write(file, content);
  }
  return {
    root,
    write,
    cleanup: (): void => {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** The files every project starts with: a call chain `a → b → c` and a type error. */
const typescriptProjectFiles: Readonly<Record<string, string>> = {
  'tsconfig.json': JSON.stringify({
    compilerOptions: {
      strict: true,
      target: 'es2022',
      module: 'esnext',
      moduleResolution: 'bundler',
      noEmit: true,
      types: [],
    },
    include: ['src'],
  }),
  'src/c.ts': 'export function c(n: number): number {\n  return n * 2;\n}\n',
  'src/b.ts':
    "import { c } from './c';\n\nexport function b(n: number): number {\n  return c(n) + 1;\n}\n",
  'src/a.ts': "import { b } from './b';\n\nexport function a(): number {\n  return b(1);\n}\n",
  'src/broken.ts': "export const answer: number = 'forty-two';\n",
  'src/wide.ts':
    "import { c } from './c';\r\n\r\nexport const label = '😀😀'; export function wide(): number { return c(3); }\r\n",
};
