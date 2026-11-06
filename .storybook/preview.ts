import type { Decorator, Preview } from '@storybook/web-components-vite';

import '../src/ui/index.css';

/**
 * Every story renders on the app's stylesheet, in the theme and diff color scheme chosen in the
 * toolbar: the theme pins the root's `color-scheme`, which the `light-dark()` tokens follow, and
 * the scheme sets `data-diff-colors` as the app's windows do (ADR 0114, 0117).
 */
const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Color scheme',
      toolbar: { title: 'Theme', icon: 'mirror', items: ['light', 'dark'], dynamicTitle: true },
    },
    diffColors: {
      description: 'Diff color scheme',
      toolbar: {
        title: 'Diff colors',
        icon: 'paintbrush',
        items: ['blue-yellow', 'red-green', 'blue-orange', 'neutral'],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'light', diffColors: 'blue-yellow' },
  decorators: [withThemeAndScheme],
};

export default preview;

function withThemeAndScheme(
  story: Parameters<Decorator>[0],
  context: Parameters<Decorator>[1],
): ReturnType<Decorator> {
  const root = document.documentElement;
  root.style.setProperty('color-scheme', String(context.globals['theme'] ?? 'light'));
  root.dataset['diffColors'] = String(context.globals['diffColors'] ?? 'blue-yellow');
  // index.css fits the app's window and clips; a story page scrolls.
  document.body.style.setProperty('overflow', 'auto');
  return story();
}
