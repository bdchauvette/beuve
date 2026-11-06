import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

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
/** The test build (ADR 0077): beside `dist/`, so electron-builder (`dist/**`) never packages it. */
const distTest = path.join(root, 'dist-test');
/**
 * esbuild's table has `using` and `await using` from Node 25, but Electron 45's Node 24.22 (and the
 * sandboxed preloads' Chromium 156) run them natively, so they pass through unlowered (ADR 0076).
 */
const nativeUsing = { using: true };

await buildAll();
await buildTestPages();

/**
 * Bundles main (ESM), the main, sheet and Settings preloads (CJS, sandboxed per ADR 0005, 0067, 0068)
 * and ui (ESM, code-split per ADR 0025, with the sheet page `sheet-entry.js` and the Settings page
 * `settings-entry.js` as further entries sharing its chunks)
 * into dist/, and copies the Tree-sitter runtime and grammar wasm files main loads from
 * `dist/main/wasm/` (ADR 0014). Prints the renderer's eager size.
 */
async function buildAll(): Promise<void> {
  await rm(dist, { recursive: true, force: true });
  const ui = await build(uiOptions());
  await Promise.all([
    build(workerOptions()),
    build(mainOptions()),
    build(preloadOptions()),
    build(sheetPreloadOptions()),
    build(settingsPreloadOptions()),
  ]);
  await copyFile(path.join(root, 'src/ui/index.html'), path.join(dist, 'ui/index.html'));
  await copyFile(path.join(root, 'src/ui/sheet.html'), path.join(dist, 'ui/sheet.html'));
  await copyFile(path.join(root, 'src/ui/settings.html'), path.join(dist, 'ui/settings.html'));
  await copyWasmAssets(path.join(dist, 'main/wasm'));
  if (ui.metafile !== undefined) {
    reportUiSize(ui.metafile);
  }
}

/**
 * With `--hostile-harness`, also builds the hostile-input harness page of
 * `scripts/check-hostile-render.ts` into `dist-test/ui/` (ADR 0077): its own entry and chunks,
 * the renderer's stylesheet, and `hostile-harness.html`, which is `index.html` with the harness
 * entry in place of the app's, so it has the production CSP. `--pass-through-policy` builds the
 * harness with a `default` policy that admits every string, the check's negative control; it
 * never touches `dist/`. `--gallery` builds the primitives gallery there too (ADR 0115).
 */
async function buildTestPages(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'hostile-harness': { type: 'boolean', default: false },
      'pass-through-policy': { type: 'boolean', default: false },
      gallery: { type: 'boolean', default: false },
    },
  });
  await rm(distTest, { recursive: true, force: true });
  if (values['hostile-harness']) {
    await buildHostileHarness(values['pass-through-policy']);
  }
  if (values.gallery) {
    await buildGallery();
  }
}

async function buildHostileHarness(isPassThrough: boolean): Promise<void> {
  const outdir = path.join(distTest, 'ui');
  await build({
    ...uiOptions(),
    entryPoints: {
      'hostile-harness': path.join(root, 'src/ui/testing/hostile-harness-entry.ts'),
      index: path.join(root, 'src/ui/index.css'),
    },
    outdir,
    metafile: false,
    // `hostile-harness-entry.ts` installs the policy this names.
    define: { hostileHarnessPolicy: JSON.stringify(harnessPolicy(isPassThrough)) },
  });
  let harness = await readFile(path.join(root, 'src/ui/index.html'), 'utf8');
  for (const [from, to] of [
    ['<title>beuve</title>', '<title>beuve hostile harness</title>'],
    ['src="./index.js"', 'src="./hostile-harness.js"'],
    ['<beuve-app></beuve-app>', ''],
  ] as const) {
    if (!harness.includes(from)) {
      throw new Error(`src/ui/index.html has no ${from}; update the hostile harness page`);
    }
    harness = harness.replace(from, () => to);
  }
  await writeFile(path.join(outdir, 'hostile-harness.html'), harness);
  const page = `hostile harness: ${path.relative(root, outdir)}/hostile-harness.html`;
  if (isPassThrough) {
    console.log(`${page}, with a pass-through policy (the negative control)`);
  } else {
    console.log(page);
  }
}

/**
 * The primitives gallery of `scripts/check-gallery.ts` (ADR 0115) in `dist-test/ui/`: its entry,
 * the renderer's stylesheet, and `gallery.html`, which is `index.html` with the gallery entry in
 * place of the app's, so it has the production CSP.
 */
async function buildGallery(): Promise<void> {
  const outdir = path.join(distTest, 'ui');
  await build({
    ...uiOptions(),
    entryPoints: {
      gallery: path.join(root, 'src/ui/testing/gallery-entry.ts'),
      index: path.join(root, 'src/ui/index.css'),
    },
    outdir,
    metafile: false,
  });
  let page = await readFile(path.join(root, 'src/ui/index.html'), 'utf8');
  for (const [from, to] of [
    ['<title>beuve</title>', '<title>beuve primitives</title>'],
    ['src="./index.js"', 'src="./gallery.js"'],
    ['<beuve-app></beuve-app>', '<beuve-gallery></beuve-gallery>'],
  ] as const) {
    if (!page.includes(from)) {
      throw new Error(`src/ui/index.html has no ${from}; update the gallery page`);
    }
    page = page.replace(from, () => to);
  }
  await writeFile(path.join(outdir, 'gallery.html'), page);
  console.log(`gallery: ${path.relative(root, outdir)}/gallery.html`);
}

function harnessPolicy(isPassThrough: boolean): string {
  if (isPassThrough) {
    return 'pass-through';
  }
  return 'sanitizing';
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
  const bytes = files.reduce((total, file) => {
    return total + (metafile.outputs[file]?.bytes ?? 0);
  }, 0);
  return `${(bytes / 1024).toFixed(0)} KiB`;
}

async function copyWasmAssets(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await Promise.all(
    listWasmAssets().map(async (asset) => {
      return copyFile(asset.sourcePath, path.join(directory, asset.fileName));
    }),
  );
}

function mainOptions(): BuildOptions {
  return {
    ...sharedOptions(),
    entryPoints: [path.join(root, 'src/main/index.ts')],
    outfile: path.join(dist, 'main/index.js'),
    // node-pty loads its native addon by path next to its own files (ADR 0095).
    external: ['electron', 'node-pty'],
    platform: 'node',
    target: 'node24',
    supported: nativeUsing,
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
    supported: nativeUsing,
    format: 'cjs',
  };
}

/** The sheet windows' preload (ADR 0067), which exposes only the sheet channels. */
function sheetPreloadOptions(): BuildOptions {
  return {
    ...preloadOptions(),
    entryPoints: [path.join(root, 'src/preload/sheet-preload.ts')],
    outfile: path.join(dist, 'preload/sheet-preload.cjs'),
  };
}

/** The Settings window's preload (ADR 0068), which exposes only the settings channels. */
function settingsPreloadOptions(): BuildOptions {
  return {
    ...preloadOptions(),
    entryPoints: [path.join(root, 'src/preload/settings-preload.ts')],
    outfile: path.join(dist, 'preload/settings-preload.cjs'),
  };
}

/**
 * The renderer splits so Shiki grammars load lazily through `import()` (ADR 0018). Chunks live in
 * `dist/ui/chunks/` and load over `file://` like the entry.
 */
function uiOptions(): BuildOptions {
  return {
    ...sharedOptions(),
    entryPoints: [
      path.join(root, 'src/ui/index.ts'),
      path.join(root, 'src/ui/sheet-entry.ts'),
      path.join(root, 'src/ui/settings-entry.ts'),
      path.join(root, 'src/ui/index.css'),
    ],
    outdir: path.join(dist, 'ui'),
    platform: 'browser',
    target: 'chrome156',
    format: 'esm',
    splitting: true,
    chunkNames: 'chunks/[name]-[hash]',
    minify: true,
    metafile: true,
    plugins: [curatedShikiPlugin()],
  };
}

/**
 * The `@pierre/diffs` highlighting worker (ADR 0050) as its own entry, `dist/ui/diff-worker/
 * worker.js`, with its own chunks. It can't be an entry of the ui build: the file has top-level
 * side effects (it installs the worker's message handler), and code splitting would hoist them
 * into a chunk the page shares. The same curated grammars and stubs apply.
 */
function workerOptions(): BuildOptions {
  return {
    ...uiOptions(),
    entryPoints: { worker: path.join(root, 'node_modules/@pierre/diffs/dist/worker/worker.js') },
    outdir: path.join(dist, 'ui/diff-worker'),
    metafile: false,
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
    .map(([name, grammar]) => {
      return `  ${JSON.stringify(name)}: () => import('shiki/langs/${grammar}.mjs'),`;
    })
    .join('\n');
  const modules: Record<string, string> = {
    langs: `export const bundledLanguages = {\n${grammars}\n};\n`,
    wasm: `const refuse = () => { throw new Error('beuve does not load the oniguruma wasm'); };\nexport default refuse;\n`,
    themes: `export const themes = { getTheme: () => undefined };\n`,
  };
  return {
    name: namespace,
    setup: (pluginBuild): void => {
      pluginBuild.onResolve({ filter: stubbedModules }, (args) => {
        return {
          path: stubbedModuleName(args.path),
          namespace,
        };
      });
      pluginBuild.onLoad({ filter: anyPath, namespace }, (args) => {
        return {
          contents: modules[args.path] ?? '',
          resolveDir: root,
          loader: 'js',
        };
      });
    },
  };
}

/** `langs` for `shiki/langs`, `wasm` for `shiki/wasm`, and `themes` for the bundled themes. */
function stubbedModuleName(specifier: string): string {
  if (specifier.startsWith('shiki/')) {
    return specifier.slice('shiki/'.length);
  }
  return 'themes';
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
