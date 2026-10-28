import path from 'node:path';

const specifierPattern =
  /\b(?:import|export)\s[^'"`;]*?\bfrom\s*(['"])([^'"\n]+)\1|\bimport\s*(['"])([^'"\n]+)\3|\b(?:import|require|vi\.mock|vi\.doMock|jest\.mock)\s*\(\s*(['"])([^'"\n]+)\5/gu;
const extensions = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const scriptExtension = /\.[cm]?jsx?$/u;

/**
 * A cheap static import graph for test selection (ADR 0036): relative specifiers in each source
 * (`import … from`, `export … from`, bare `import '…'`, `import()`, `require()`, `vi.mock()`) are
 * resolved against `files` the way TypeScript and bundlers do (`.js` written for `.ts`, missing
 * extensions, `index` files). Package and alias specifiers are ignored. Comments and strings that
 * merely look like imports may add edges; for ranking tests that is harmless.
 */
export function buildImportGraph(
  sources: ReadonlyMap<string, string>,
  files: Iterable<string>,
): Map<string, string[]> {
  const known = new Set(files);
  const graph = new Map<string, string[]>();
  for (const [file, text] of sources) {
    const targets = new Set<string>();
    for (const match of text.matchAll(specifierPattern)) {
      const specifier = match[2] ?? match[4] ?? match[6];
      if (specifier?.startsWith('.') !== true) {
        continue;
      }
      const resolved = resolveRelative(file, specifier, known);
      if (resolved !== undefined && resolved !== file) {
        targets.add(resolved);
      }
    }
    graph.set(file, [...targets]);
  }
  return graph;
}

function resolveRelative(
  from: string,
  specifier: string,
  known: ReadonlySet<string>,
): string | undefined {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  const stripped = base.replace(scriptExtension, '');
  const candidates = [
    base,
    ...extensions.map((extension) => `${stripped}${extension}`),
    ...extensions.map((extension) => `${base}${extension}`),
    ...extensions.map((extension) => `${base}/index${extension}`),
  ];
  return candidates.find((candidate) => known.has(candidate));
}
