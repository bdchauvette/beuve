declare module 'eslint-plugin-promise' {
  import type { ESLint, Linter } from 'eslint';

  const plugin: ESLint.Plugin & { configs: Record<'flat/recommended', Linter.Config> };
  export default plugin;
}
