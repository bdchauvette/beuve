/** Import rules from ADR 0002. Run with `npm run deps`. */
/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies make modules impossible to reason about in isolation.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'domain-isolation',
      severity: 'error',
      comment: 'A domain may import only itself and #x/*; coordinate through src/main.',
      from: { path: '^src/internal/([^/]+)/' },
      to: { path: '^src/internal/', pathNot: '^src/internal/$1/' },
    },
    {
      name: 'x-is-leaf',
      severity: 'error',
      comment: 'src/x may import only Node built-ins and other src/x modules.',
      from: { path: '^src/x/', pathNot: '\\.test\\.ts$' },
      to: { pathNot: '^src/x/', dependencyTypesNot: ['core'] },
    },
    {
      name: 'x-no-npm',
      severity: 'error',
      comment: 'src/x has zero external dependencies.',
      from: { path: '^src/x/', pathNot: '\\.test\\.ts$' },
      to: { dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-bundled'] },
    },
    {
      name: 'contract-is-leaf',
      severity: 'error',
      comment: 'src/contract (ADR 0011) may import only itself and src/x: no npm, no built-ins.',
      from: { path: '^src/contract/', pathNot: '\\.test\\.ts$' },
      to: { pathNot: '^src/(contract|x)/' },
    },
    {
      name: 'contract-is-node-free',
      severity: 'error',
      comment: 'The contract is bundled into the sandboxed preload and the renderer.',
      from: { path: '^src/contract/', pathNot: '\\.test\\.ts$' },
      to: { path: '^(?!src/|node_modules/)', reachable: true },
    },
    {
      name: 'renderer-not-to-main',
      severity: 'error',
      comment: 'ui and preload talk to main only through the IPC contract.',
      from: { path: '^src/(ui|preload)/' },
      to: { path: '^src/(main|internal)/' },
    },
    {
      name: 'internal-not-to-processes',
      severity: 'error',
      comment: 'Domains never depend on a process layer or the IPC contract; main composes them.',
      from: { path: '^src/internal/' },
      to: { path: '^src/(main|ui|preload|contract)/' },
    },
    {
      name: 'main-not-to-renderer',
      severity: 'error',
      comment: 'main, preload and ui are separate bundles for separate processes.',
      from: { path: '^src/main/' },
      to: { path: '^src/(ui|preload)/' },
    },
    {
      name: 'no-entrypoint-imports',
      severity: 'error',
      comment: 'Process entrypoints (src/*/index.ts) are never imported.',
      from: {},
      to: { path: '^src/[^/]+/index\\.ts$' },
    },
    {
      name: 'testing-only-in-tests',
      severity: 'error',
      comment:
        'Test helpers live in testing/ directories (ADR 0013); only tests and other helpers may import them, so no bundle can reach them.',
      from: { path: '^src/', pathNot: ['\\.test\\.ts$', '/testing/'] },
      to: { path: '/testing/' },
    },
    {
      name: 'pierre-only-in-wrappers',
      severity: 'error',
      comment:
        'Only beuve-file-card and beuve-radar-tree import @pierre/* (ADR 0018), so a library swap stays local; tests may.',
      from: {
        path: '^src/',
        pathNot: ['^src/ui/beuve-(file-card|radar-tree)\\.ts$', '\\.test\\.ts$'],
      },
      to: { path: '^node_modules/@pierre/' },
    },
    {
      name: 'no-dev-deps-in-src',
      severity: 'error',
      comment: 'Application code may not use devDependencies (electron is provided at runtime).',
      from: { path: '^src/', pathNot: '\\.test\\.ts$' },
      to: {
        dependencyTypes: ['npm-dev'],
        dependencyTypesNot: ['type-only'],
        pathNot: '^node_modules/electron/',
      },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment: 'Every import must resolve, including #internal/* and #x/* aliases.',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-non-package-json',
      severity: 'error',
      comment: 'npm modules must be declared in package.json.',
      from: {},
      to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'A module nothing imports is dead code or a missing entrypoint.',
      from: {
        orphan: true,
        pathNot: ['\\.d\\.ts$', '\\.test\\.ts$', '^src/[^/]+/index\\.ts$', '(^|/)tsconfig\\.json$'],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.js', '.json'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
