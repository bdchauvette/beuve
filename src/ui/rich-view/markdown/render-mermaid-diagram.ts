import type { Mermaid } from 'mermaid';

import { errorFrom } from '#x/error/error-from.ts';
import type { Result } from '#x/result/result.ts';

/** A diagram to draw, and the color scheme to draw it in. */
export interface MermaidDiagramRequest {
  readonly source: string;
  readonly isDark: boolean;
}

const shared: { mermaid: Promise<Mermaid> | undefined; queue: Promise<unknown>; count: number } = {
  mermaid: undefined,
  queue: Promise.resolve(),
  count: 0,
};

/**
 * A Mermaid diagram as a `data:image/svg+xml` URI for an `<img>` (ADR 0123), or Mermaid's error.
 * Mermaid is a lazy chunk, loaded on the first diagram, with `securityLevel: 'strict'` and SVG
 * text labels. Its output is only ever shown as an image, never put into the document, so no
 * script or link in it can run or reach the page. Diagrams are drawn one at a time, because
 * Mermaid's configuration is global.
 */
export async function renderMermaidDiagram(
  request: MermaidDiagramRequest,
): Promise<Result<string, string>> {
  shared.mermaid ??= loadMermaid();
  const mermaid = await shared.mermaid;
  const previous = shared.queue;
  const drawn = (async (): Promise<Result<string, string>> => {
    await previous;
    return draw(mermaid, request);
  })();
  shared.queue = drawn;
  return drawn;
}

async function draw(
  mermaid: Mermaid,
  { source, isDark }: MermaidDiagramRequest,
): Promise<Result<string, string>> {
  shared.count += 1;
  const id = `beuve-mermaid-${String(shared.count)}`;
  let theme: 'dark' | 'default' = 'default';
  if (isDark) {
    theme = 'dark';
  }
  mermaid.initialize({ ...baseConfig, theme });
  using cleanup = new DisposableStack();
  cleanup.defer(() => {
    // Mermaid leaves its measuring node behind when a diagram fails to parse.
    document.querySelector(`#d${id}`)?.remove();
  });
  try {
    const { svg } = await mermaid.render(id, source);
    return { ok: true, value: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` };
  } catch (error: unknown) {
    return { ok: false, error: errorFrom(error).message };
  }
}

const baseConfig = {
  startOnLoad: false,
  securityLevel: 'strict',
  htmlLabels: false,
  fontFamily: 'system-ui, sans-serif',
  suppressErrorRendering: true,
} as const;

async function loadMermaid(): Promise<Mermaid> {
  const module = await import('mermaid');
  return module.default;
}
