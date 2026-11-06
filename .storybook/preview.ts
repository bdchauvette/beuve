import type { Decorator, Preview } from '@storybook/web-components-vite';

import '../src/ui/index.css';

/**
 * Every story renders on the app's stylesheet, in the theme chosen in the toolbar: it pins the
 * root's `color-scheme`, which the `light-dark()` tokens follow (ADR 0114, 0117).
 */
const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Color scheme',
      toolbar: { title: 'Theme', icon: 'mirror', items: ['light', 'dark'], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: 'light' },
  decorators: [withTheme],
};

export default preview;

function withTheme(
  story: Parameters<Decorator>[0],
  context: Parameters<Decorator>[1],
): ReturnType<Decorator> {
  const root = document.documentElement;
  root.style.setProperty('color-scheme', String(context.globals['theme'] ?? 'light'));
  // index.css fits the app's window and clips; a story page scrolls.
  document.body.style.setProperty('overflow', 'auto');
  return story();
}
