import type { Mermaid } from 'mermaid';

import { errorFrom } from '#x/error/error-from.ts';
import type { Result } from '#x/result/result.ts';

import { withoutHandlers } from './without-handlers.ts';

/** A drawn diagram: its SVG as a `data:` URI, and its natural width in CSS pixels, if it says. */
export interface MermaidDiagram {
  readonly uri: string;
  readonly width?: number;
}

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
): Promise<Result<MermaidDiagram, string>> {
  shared.mermaid ??= loadMermaid();
  const mermaid = await shared.mermaid;
  const previous = shared.queue;
  const drawn = (async (): Promise<Result<MermaidDiagram, string>> => {
    await previous;
    return draw(mermaid, request);
  })();
  shared.queue = drawn;
  return drawn;
}

async function draw(
  mermaid: Mermaid,
  { source, isDark }: MermaidDiagramRequest,
): Promise<Result<MermaidDiagram, string>> {
  shared.count += 1;
  const id = `beuve-mermaid-${String(shared.count)}`;
  let theme: 'dark' | 'default' = 'default';
  if (isDark) {
    theme = 'dark';
  }
  mermaid.initialize({ ...baseConfig, secure: [...baseConfig.secure], theme });
  using cleanup = new DisposableStack();
  cleanup.defer(() => {
    // Mermaid leaves its measuring node behind when a diagram fails to parse.
    document.querySelector(`#d${id}`)?.remove();
  });
  try {
    const { svg } = await mermaid.render(id, withoutHandlers(source));
    const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    const width = Number(maxWidth.exec(svg)?.[1]);
    if (Number.isFinite(width) && width > 0) {
      return { ok: true, value: { uri, width: Math.ceil(width) } };
    }
    return { ok: true, value: { uri } };
  } catch (error: unknown) {
    return { ok: false, error: errorFrom(error).message };
  }
}

/** Mermaid sizes a diagram to its container with `max-width: <n>px` on the root, its natural width. */
const maxWidth = /max-width:\s*([\d.]+)px/u;

const baseConfig = {
  // An `%%{init}%%` directive in a diagram may not change these: Mermaid's own list, and labels.
  secure: [
    'secure',
    'securityLevel',
    'startOnLoad',
    'maxTextSize',
    'suppressErrorRendering',
    'maxEdges',
    'htmlLabels',
  ],
  startOnLoad: false,
  securityLevel: 'strict',
  htmlLabels: false,
  fontFamily: 'system-ui, sans-serif',
  suppressErrorRendering: true,
} as const;

/**
 * Mermaid, loaded with `trustedTypes` hidden: the DOMPurify inside it reads the factory once, as
 * its module is evaluated, and would otherwise create a `dompurify` policy, which the CSP refuses
 * (ADR 0077). Without one, Mermaid's markup goes through beuve's `default` policy like every other
 * library's.
 */
async function loadMermaid(): Promise<Mermaid> {
  using hidden = new DisposableStack();
  const factory = Object.getOwnPropertyDescriptor(globalThis, 'trustedTypes');
  Object.defineProperty(globalThis, 'trustedTypes', {
    value: undefined,
    configurable: true,
    writable: true,
  });
  hidden.defer(() => {
    if (factory === undefined) {
      Reflect.deleteProperty(globalThis, 'trustedTypes');
    } else {
      Object.defineProperty(globalThis, 'trustedTypes', factory);
    }
  });
  const module = await import('mermaid');
  return module.default;
}
