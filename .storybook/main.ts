import type { StorybookConfig } from '@storybook/web-components-vite';
import { transform } from 'esbuild';

/** Vite's config and plugin types, as Storybook hands them over (Vite is Storybook's, not ours). */
type ViteConfig = Parameters<NonNullable<StorybookConfig['viteFinal']>>[0];
type VitePlugin = Extract<NonNullable<ViteConfig['plugins']>[number], { readonly name: string }>;

/** What the plugin hands back for a module it lowered. */
interface LoweredModule {
  readonly code: string;
  readonly map: string;
}

const rendererTypeScript = /\/src\/ui\/.*\.ts$/u;

/** Storybook for the renderer's primitives (ADR 0117): the stories in `src/ui/stories/`. */
const config: StorybookConfig = {
  stories: ['../src/ui/stories/*.stories.ts'],
  framework: '@storybook/web-components-vite',
  core: { disableTelemetry: true },
  viteFinal: (vite) => {
    return {
      ...vite,
      plugins: [esbuildTypeScript(), ...(vite.plugins ?? [])],
      // Keep `light-dark()` (ADR 0114): lowered, it would ignore the toolbar's `color-scheme`.
      build: { ...vite.build, cssTarget: ['chrome123', 'firefox120', 'safari17.5'] },
    };
  },
};

export default config;

/**
 * Lowers the renderer's TypeScript with esbuild, as `scripts/build.ts` does, before Vite's own
 * transform: Lit's standard decorators (`@customElement`, `accessor`) are not lowered by Vite's,
 * and no browser runs them natively yet.
 */
function esbuildTypeScript(): VitePlugin {
  return {
    name: 'beuve-esbuild-typescript',
    enforce: 'pre',
    // eslint-disable-next-line local/no-same-type-positional-params -- Vite calls transform(code, id).
    transform: async (code: string, id: string): Promise<LoweredModule | undefined> => {
      if (!rendererTypeScript.test(id)) {
        return;
      }
      const lowered = await transform(code, {
        loader: 'ts',
        target: 'es2022',
        sourcemap: true,
        sourcefile: id,
      });
      return { code: lowered.code, map: lowered.map };
    },
  };
}
