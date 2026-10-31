import type * as Diffs from '@pierre/diffs';

import { errorFrom } from '#x/error/error-from.ts';

import type { ChatEntry } from '../chat-entry.ts';
import { diffsThemeNames } from '../diffs-theme-names.ts';
import { loadDiffsLibrary } from '../load-diffs-library.ts';

import { extraMarkup } from './extra-markup.ts';
import { hostileCorpus } from './hostile-corpus.ts';
import type {
  HostileCorpus,
  HostileDiffCase,
  HostileFile,
  HostileFileCase,
  HostileInput,
} from './hostile-corpus.ts';
import type { DiffHtmlOptions } from './render-diff-html.ts';
import { visibleText } from './visible-text.ts';

/** The corpus groups the harness renders, by their names in `HostileCorpus`. */
export type HarnessGroup = Exclude<keyof HostileCorpus, 'names' | 'contents'>;

/** What one case of a group found; no failures means it rendered inert and visible. */
export interface HarnessVerdict {
  readonly title: string;
  readonly failures: readonly string[];
}

/** What a hostile language must fail with, as `pierre-diffs-escaping.test.ts` expects. */
const unknownLanguage = 'not found in bundled or custom languages';
/** How often a render is serialized while it settles, and for how long at most, in milliseconds. */
const pollMilliseconds = 40;
const settleMilliseconds = 15_000;
/** Serializations that must match in a row before a render counts as settled. */
const stablePolls = 3;

/**
 * Renders the hostile-input corpus (ADR 0077) inside the built renderer, with the production CSP
 * and the Trusted Types policy its page installs, through the real components: `@pierre/diffs`'
 * `FileDiff` in split and unified views with both separator styles, its `File`, and the chat
 * drawer's Markdown code blocks. Each case renders with its benign twin, and its verdict applies
 * the Node test's oracle to the live DOM, shadow roots included: no element or attribute the twin
 * lacks, and the hostile text visible as text. The renders stay mounted until `clear`, so the
 * caller can inspect the page. Loaded only by the test build's `hostile-harness.html`.
 */
export class HostileHarness {
  private readonly root: HTMLElement;
  private readonly views: { cleanUp: () => void }[] = [];

  constructor(root: HTMLElement) {
    this.root = root;
  }

  private async diffVerdict(
    library: typeof Diffs,
    group: HarnessGroup,
    entry: HostileDiffCase,
  ): Promise<HarnessVerdict> {
    const [hostile, benign] = await Promise.all([
      this.renderDiff(library, entry.hostile, entry.options),
      this.renderDiff(library, entry.benign, entry.options),
    ]);
    return verdict(titleOf(group, entry, entry.options), hostile, benign, entry.visible);
  }

  private async fileVerdict(
    library: typeof Diffs,
    group: HarnessGroup,
    entry: HostileFileCase,
  ): Promise<HarnessVerdict> {
    const [hostile, benign] = await Promise.all([
      this.renderFile(library, entry.hostile),
      this.renderFile(library, entry.benign),
    ]);
    return verdict(titleOf(group, entry), hostile, benign, entry.visible);
  }

  /**
   * A hostile language must fail to highlight, as it fails to render in Node: the library
   * reports it with `console.error`, which is this case's expected outcome, and keeps the plain
   * lines it drew first, with nothing a benign unknown language does not. One render at a time,
   * so each error is its own.
   */
  private async failureVerdict(
    group: HarnessGroup,
    entry: HostileInput,
    render: (which: 'hostile' | 'benign', isDrawn: () => boolean) => Promise<Rendered>,
  ): Promise<HarnessVerdict> {
    const hostile = await withConsoleErrors(async (errors) =>
      render('hostile', () => errors.length > 0),
    );
    const benign = await withConsoleErrors(async (errors) =>
      render('benign', () => errors.length > 0),
    );
    const base = verdict(titleOf(group, entry), hostile.rendered, benign.rendered, []);
    const reported = hostile.errors.join('\n');
    return {
      ...base,
      failures: [
        ...base.failures,
        ...(reported.includes(unknownLanguage)
          ? []
          : [`no "${unknownLanguage}" error, but ${JSON.stringify(reported)}`]),
      ],
    };
  }

  /**
   * One chat drawer holds an answer per hostile info string and another the benign twins; each
   * answer is a closed fence whose info string and contents are the hostile text. A tilde fence,
   * because a backtick fence's info string cannot hold a backtick.
   */
  private async codeBlockVerdicts(
    entries: readonly HostileFileCase[],
  ): Promise<readonly HarnessVerdict[]> {
    const [hostile, benign] = await Promise.all([
      this.renderCodeBlocks(entries.map((entry) => ({ info: entry.text, code: entry.text }))),
      this.renderCodeBlocks(entries.map(() => ({ info: 'ts', code: 'benign' }))),
    ]);
    return entries.map((entry, index) =>
      verdict(
        titleOf('codeBlocks', entry),
        hostile[index] ?? missing,
        benign[index] ?? missing,
        entry.visible,
      ),
    );
  }

  private async renderDiff(
    library: typeof Diffs,
    patch: string,
    options: DiffHtmlOptions,
    isDrawn?: () => boolean,
  ): Promise<Rendered> {
    const host = this.host();
    const parsed = library.processFile(patch, { cacheKey: crypto.randomUUID(), isGitDiff: true });
    if (parsed === undefined) {
      return { ...missing, failures: ['@pierre/diffs found no file in the patch'] };
    }
    const diff = new library.FileDiff({
      theme: diffsThemeNames,
      themeType: 'system',
      preferredHighlighter: 'shiki-js',
      diffStyle: options.diffStyle,
      hunkSeparators: options.hunkSeparators,
      lineDiffType: 'word-alt',
      overflow: 'scroll',
    });
    this.views.push(diff);
    diff.render({
      fileDiff:
        options.language === undefined
          ? parsed
          : library.setLanguageOverride(parsed, options.language),
      containerWrapper: host,
    });
    return settled(host, isDrawn);
  }

  private async renderFile(
    library: typeof Diffs,
    file: HostileFile,
    isDrawn?: () => boolean,
  ): Promise<Rendered> {
    const host = this.host();
    const view = new library.File({
      theme: diffsThemeNames,
      themeType: 'system',
      preferredHighlighter: 'shiki-js',
      overflow: 'scroll',
    });
    this.views.push(view);
    view.render({ file: { ...file, cacheKey: crypto.randomUUID() }, containerWrapper: host });
    return settled(host, isDrawn);
  }

  /** Answers in a real chat drawer, one code block each, and each block once it has settled. */
  private async renderCodeBlocks(
    blocks: readonly { readonly info: string; readonly code: string }[],
  ): Promise<readonly Rendered[]> {
    const drawer = document.createElement('beuve-chat-drawer');
    drawer.transcript = blocks.map((block, index): ChatEntry => answerWith(index, block));
    this.root.append(drawer);
    await drawer.updateComplete;
    const found = [...drawer.renderRoot.querySelectorAll<HTMLElement>('.code-block')];
    if (found.length !== blocks.length) {
      return blocks.map(() => ({
        ...missing,
        failures: [`the drawer shows ${String(found.length)} code blocks`],
      }));
    }
    return Promise.all(found.map(async (block) => settled(block)));
  }

  private host(): HTMLElement {
    const host = document.createElement('div');
    this.root.append(host);
    return host;
  }

  /** Every group, in the order the corpus lists them. */
  groups(): readonly HarnessGroup[] {
    return [
      'fileNames',
      'renames',
      'lines',
      'hunkContexts',
      'shownHunkContexts',
      'diffLanguages',
      'sheets',
      'codeBlocks',
      'sheetLanguages',
    ];
  }

  /** Renders every case of `group` and its twin, and returns a verdict for each. */
  async run(group: HarnessGroup): Promise<readonly HarnessVerdict[]> {
    const library = await loadDiffsLibrary();
    const corpus = hostileCorpus();
    switch (group) {
      case 'fileNames':
      case 'renames':
      case 'lines':
      case 'hunkContexts':
      case 'shownHunkContexts': {
        return Promise.all(
          corpus[group].map(async (entry) => this.diffVerdict(library, group, entry)),
        );
      }
      case 'diffLanguages': {
        return inTurn(corpus.diffLanguages, async (entry) =>
          this.failureVerdict(group, entry, async (which, isDrawn) =>
            this.renderDiff(
              library,
              entry.patch,
              {
                ...entry.options,
                language: which === 'hostile' ? entry.options.language : 'benign-language',
              },
              isDrawn,
            ),
          ),
        );
      }
      case 'sheets': {
        return Promise.all(
          corpus.sheets.map(async (entry) => this.fileVerdict(library, group, entry)),
        );
      }
      case 'codeBlocks': {
        return this.codeBlockVerdicts(corpus.codeBlocks);
      }
      case 'sheetLanguages': {
        return inTurn(corpus.sheetLanguages, async (entry) =>
          this.failureVerdict(group, entry, async (which, isDrawn) =>
            this.renderFile(
              library,
              { ...entry.file, lang: which === 'hostile' ? entry.file.lang : 'benign-language' },
              isDrawn,
            ),
          ),
        );
      }
    }
  }

  /** Unmounts every render. */
  clear(): void {
    for (const view of this.views.splice(0)) {
      view.cleanUp();
    }
    this.root.replaceChildren();
  }
}

/** A settled render: its serialization, shadow roots included, and its code rows. */
interface Rendered {
  readonly html: string;
  readonly rows: number;
  readonly failures: readonly string[];
}

const missing: Rendered = { html: '', rows: 0, failures: ['nothing rendered'] };

function titleOf(group: HarnessGroup, entry: HostileInput, options?: DiffHtmlOptions): string {
  const view = options === undefined ? '' : ` (${options.diffStyle}, ${options.hunkSeparators})`;
  return `${group} ${entry.label}${view}`;
}

function verdict(
  title: string,
  hostile: Rendered,
  benign: Rendered,
  visible: readonly string[],
): HarnessVerdict {
  const text = visibleText([hostile.html]);
  return {
    title,
    failures: [
      ...hostile.failures,
      ...benign.failures.map((failure) => `benign twin: ${failure}`),
      ...extraMarkup([hostile.html], [benign.html]).map((entry) => `extra markup: ${entry}`),
      ...visible
        .filter((entry) => !text.includes(entry))
        .map((entry) => `not visible as text: ${JSON.stringify(entry)}`),
    ],
  };
}

function answerWith(
  index: number,
  block: { readonly info: string; readonly code: string },
): ChatEntry {
  const id = `answer-${String(index)}`;
  return {
    id,
    kind: 'message',
    message: {
      id,
      sessionId: 'hostile-harness',
      headSha: '0'.repeat(40),
      role: 'assistant',
      parts: [{ kind: 'text', id: 'text', text: `~~~${block.info}\n${block.code}\n~~~\n` }],
      citations: [],
      status: 'done',
      answerKind: 'answer',
      createdAt: '2026-10-31T00:00:00Z',
    },
  };
}

/** `each` of `entries`, one after another. */
async function inTurn<T>(
  entries: readonly T[],
  each: (entry: T) => Promise<HarnessVerdict>,
): Promise<readonly HarnessVerdict[]> {
  const verdicts: HarnessVerdict[] = [];
  for (const entry of entries) {
    verdicts.push(await each(entry));
  }
  return verdicts;
}

/**
 * What `render` returns, with what `console.error` was called with meanwhile instead of logging
 * it: the expected failure of a hostile language.
 */
async function withConsoleErrors(
  render: (errors: readonly string[]) => Promise<Rendered>,
): Promise<{ readonly rendered: Rendered; readonly errors: readonly string[] }> {
  const errors: string[] = [];
  const original = console.error;
  using restore = new DisposableStack();
  restore.defer(() => {
    console.error = original;
  });
  console.error = (...args: unknown[]): void => {
    errors.push(args.map((arg) => errorFrom(arg).message).join(' '));
  };
  return { rendered: await render(errors), errors };
}

/**
 * Serializes `host` with every shadow root under it until the serialization stops changing and
 * it shows code rows (or `isDrawn`), so highlighting has finished.
 */
async function settled(host: HTMLElement, isDrawn?: () => boolean): Promise<Rendered> {
  let last = '';
  let stable = 0;
  for (let waited = 0; waited < settleMilliseconds; waited += pollMilliseconds) {
    await new Promise((resolve) => {
      setTimeout(resolve, pollMilliseconds);
    });
    const html = host.getHTML({ shadowRoots: shadowRootsUnder(host) });
    const rows = countRows(host);
    const isDone = isDrawn === undefined ? rows > 0 : isDrawn();
    stable = html === last && isDone ? stable + 1 : 0;
    last = html;
    if (stable >= stablePolls) {
      return { html, rows, failures: [] };
    }
  }
  return { html: last, rows: countRows(host), failures: ['the render never settled'] };
}

function shadowRootsUnder(start: Element | ShadowRoot): ShadowRoot[] {
  return [...start.querySelectorAll('*')].flatMap((element) =>
    element.shadowRoot === null
      ? []
      : [element.shadowRoot, ...shadowRootsUnder(element.shadowRoot)],
  );
}

function countRows(host: HTMLElement): number {
  return [host, ...shadowRootsUnder(host)].reduce(
    (total, root) => total + root.querySelectorAll('[data-line]').length,
    0,
  );
}
