import { copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { build } from 'esbuild';
import type { BuildOptions, Metafile, Plugin } from 'esbuild';

import { listWasmAssets } from '../src/internal/syntax/list-wasm-assets.ts';
import { highlightedLanguages } from '../src/ui/highlighted-languages.ts';

const root = path.resolve(import.meta.dirname, '..');
/** esbuild filters are Go regular expressions, which take no `u` flag. */
const stubbedModules =
  /^(?:shiki\/(?:langs|wasm)|@pierre\/theming\/themes|@pierre\/highlights\/themes\/loader)$/;
const anyPath = /.*/;
const dist = path.join(root, 'dist');

await buildAll();

/**
 * Bundles main (ESM), preload (CJS, sandboxed per ADR 0005) and ui (ESM, code-split per ADR 0025)
 * into dist/, and copies the Tree-sitter runtime and grammar wasm files main loads from
 * `dist/main/wasm/` (ADR 0014). Prints the renderer's eager size.
 */
async function buildAll(): Promise<void> {
  await rm(dist, { recursive: true, force: true });
  const ui = await build(uiOptions());
  await Promise.all([build(mainOptions()), build(preloadOptions())]);
  await copyFile(path.join(root, 'src/ui/index.html'), path.join(dist, 'ui/index.html'));
  await copyWasmAssets(path.join(dist, 'main/wasm'));
  if (ui.metafile !== undefined) {
    reportUiSize(ui.metafile);
  }
}

/** Logs what the renderer loads up front (the entry and its static imports) and what lazily. */
function reportUiSize(metafile: Metafile): void {
  const scripts = Object.keys(metafile.outputs).filter((file) => file.endsWith('.js'));
  const eager = new Set<string>();
  const pending = scripts.filter((file) => file.endsWith('ui/index.js'));
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    eager.add(file);
    const imports = metafile.outputs[file]?.imports ?? [];
    for (const imported of imports) {
      if (imported.kind === 'import-statement' && !eager.has(imported.path)) {
        pending.push(imported.path);
      }
    }
  }
  const lazy = scripts.filter((file) => !eager.has(file));
  console.log(
    `ui: eager ${kib(metafile, [...eager])} in ${String(eager.size)} files, ` +
      `${kib(metafile, lazy)} lazy in ${String(lazy.length)} chunks`,
  );
}

function kib(metafile: Metafile, files: readonly string[]): string {
  const bytes = files.reduce((total, file) => total + (metafile.outputs[file]?.bytes ?? 0), 0);
  return `${(bytes / 1024).toFixed(0)} KiB`;
}

async function copyWasmAssets(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await Promise.all(
    listWasmAssets().map(async (asset) =>
      copyFile(asset.sourcePath, path.join(directory, asset.fileName)),
    ),
  );
}

function mainOptions(): BuildOptions {
  return {
    ...sharedOptions(),
    entryPoints: [path.join(root, 'src/main/index.ts')],
    outfile: path.join(dist, 'main/index.js'),
    platform: 'node',
    target: 'node24',
    format: 'esm',
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
  };
}

function preloadOptions(): BuildOptions {
  return {
    ...sharedOptions(),
    entryPoints: [path.join(root, 'src/preload/index.ts')],
    outfile: path.join(dist, 'preload/index.cjs'),
    platform: 'node',
    target: 'node24',
    format: 'cjs',
  };
}

/**
 * The renderer splits so Shiki grammars load lazily through `import()` (ADR 0018). Chunks live in
 * `dist/ui/chunks/` and load over `file://` like the entry.
 */
function uiOptions(): BuildOptions {
  return {
    ...sharedOptions(),
    entryPoints: [path.join(root, 'src/ui/index.ts'), path.join(root, 'src/ui/index.css')],
    outdir: path.join(dist, 'ui'),
    platform: 'browser',
    target: 'chrome140',
    format: 'esm',
    splitting: true,
    chunkNames: 'chunks/[name]-[hash]',
    minify: true,
    metafile: true,
    plugins: [curatedShikiPlugin()],
  };
}

/**
 * Replaces `shiki/langs` with the curated grammars of `highlightedLanguages`, `shiki/wasm` (the
 * inlined oniguruma binary) with a module that refuses to load, and the libraries' bundled theme
 * catalogs with empty ones: beuve highlights with the JavaScript regex engine and its own themes
 * only (ADR 0025).
 */
function curatedShikiPlugin(): Plugin {
  const namespace = 'beuve-curated-shiki';
  const grammars = Object.entries(highlightedLanguages)
    .map(
      ([name, grammar]) => `  ${JSON.stringify(name)}: () => import('shiki/langs/${grammar}.mjs'),`,
    )
    .join('\n');
  const modules: Record<string, string> = {
    langs: `export const bundledLanguages = {\n${grammars}\n};\n`,
    wasm: `const refuse = () => { throw new Error('beuve does not load the oniguruma wasm'); };\nexport default refuse;\n`,
    themes: `export const themes = { getTheme: () => undefined };\n`,
  };
  return {
    name: namespace,
    setup: (pluginBuild): void => {
      pluginBuild.onResolve({ filter: stubbedModules }, (args) => ({
        path: args.path.startsWith('shiki/') ? args.path.slice('shiki/'.length) : 'themes',
        namespace,
      }));
      pluginBuild.onLoad({ filter: anyPath, namespace }, (args) => ({
        contents: modules[args.path] ?? '',
        resolveDir: root,
        loader: 'js',
      }));
    },
  };
}

function sharedOptions(): BuildOptions {
  return {
    bundle: true,
    external: ['electron'],
    sourcemap: 'linked',
    logLevel: 'warning',
    absWorkingDir: root,
  };
}
