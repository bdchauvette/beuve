import { EditorState, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { Decoration, EditorView, drawSelection, keymap } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { history, indentLess, indentMore, redo, standardKeymap, undo } from '@codemirror/commands';

import { suggestionEditorTheme } from './suggestion-editor-theme.ts';
import type { TokenMark } from './token-marks-from.ts';

/** Where a suggestion editor goes, what it starts with, and whom it tells. */
export interface SuggestionEditorOptions {
  /** The element the editor is built in, already in `root`. */
  readonly parent: HTMLElement;
  /** The field's shadow root, where CodeMirror adopts its styles (ADR 0162). */
  readonly root: ShadowRoot;
  readonly text: string;
  /** The editor's accessible name. */
  readonly label: string;
  /** ⌘/Ctrl+Return. */
  readonly onSave: () => void;
  /** Escape. */
  readonly onCancel: () => void;
  /** The text `\n`-joined, as highlighting reads it: once at the start, then after every change. */
  readonly onChange: (text: string) => void;
}

/** A suggestion field's CodeMirror editor, as {@link createSuggestionEditor} builds it. */
export interface SuggestionEditor {
  /** The text as typed, `\n`-joined (or `\r\n` for a field that started with CRLF lines). */
  text(): string;
  /** Replaces the highlighting with `marks` of `text`, unless the text has changed since. */
  mark(marks: readonly TokenMark[], text: string): void;
  focus(): void;
  destroy(): void;
}

/**
 * A suggestion field's editor (ADR 0162): CodeMirror 6 with history, the platform's caret and
 * selection keys, indent and outdent on ⌘] / ⌘[ (Ctrl+] / Ctrl+[), ⌘/Ctrl+Return to save and
 * Escape to cancel. Tab is not bound, so it moves focus as everywhere else (ADR 0068), and nothing
 * binds ⌘/ or ⌥↑/↓. `drawSelection` draws the selection and caret, so they take the theme's
 * tokens. Highlighting arrives as marks from beuve's own highlighter; no language package loads.
 * A field that starts with CRLF lines keeps them.
 */
export function createSuggestionEditor(options: SuggestionEditorOptions): SuggestionEditor {
  const view = new EditorView({
    parent: options.parent,
    root: options.root,
    state: EditorState.create({ doc: options.text, extensions: extensionsFor(options) }),
  });
  options.onChange(view.state.doc.toString());
  return {
    text: (): string => {
      return view.state.sliceDoc();
    },
    mark: (marks, text): void => {
      if (view.state.doc.toString() === text) {
        view.dispatch({ effects: marksEffect.of(marks) });
      }
    },
    focus: (): void => {
      view.focus();
    },
    destroy: (): void => {
      view.destroy();
    },
  };
}

function extensionsFor(options: SuggestionEditorOptions): Extension[] {
  const extensions: Extension[] = [
    history(),
    drawSelection(),
    keymap.of([
      { key: 'Mod-z', run: undo, preventDefault: true },
      { key: 'Mod-Shift-z', run: redo, preventDefault: true },
      { key: 'Mod-]', run: indentMore, preventDefault: true },
      { key: 'Mod-[', run: indentLess, preventDefault: true },
      {
        key: 'Mod-Enter',
        run: (): boolean => {
          options.onSave();
          return true;
        },
      },
      {
        key: 'Escape',
        run: (): boolean => {
          options.onCancel();
          return true;
        },
      },
      ...standardKeymap,
    ]),
    EditorView.contentAttributes.of({ 'aria-label': options.label, 'aria-multiline': 'true' }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        options.onChange(update.state.doc.toString());
      }
    }),
    marksField,
    suggestionEditorTheme,
  ];
  if (options.text.includes('\r\n')) {
    extensions.push(EditorState.lineSeparator.of('\r\n'));
  }
  return extensions;
}

const marksEffect = StateEffect.define<readonly TokenMark[]>();

/** The highlighting, moved along with each edit until marks of the new text replace it. */
const marksField = StateField.define<DecorationSet>({
  create: (): DecorationSet => {
    return Decoration.none;
  },
  update: (marks, transaction): DecorationSet => {
    let next = marks.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(marksEffect)) {
        next = decorationsFrom(effect.value, transaction.newDoc.length);
      }
    }
    return next;
  },
  provide: (field): Extension => {
    return EditorView.decorations.from(field);
  },
});

function decorationsFrom(marks: readonly TokenMark[], length: number): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  let last = 0;
  for (const { from, to, style } of marks) {
    if (from < last || to > length || from >= to) {
      continue;
    }
    builder.add(from, to, Decoration.mark({ class: 'beuve-token', attributes: { style } }));
    last = to;
  }
  return builder.finish();
}
