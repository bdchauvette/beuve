import { EditorView } from '@codemirror/view';

/**
 * A suggestion field's look (ADR 0162), only `--beuve-*` tokens and logical properties: code on the
 * code background in the code font, bordered as the note's body is, with the accent border while
 * focused. It overrides every visible value of CodeMirror's base theme (the focus outline, the
 * scroller's font and line height, the content and line padding, the caret, the selection, special
 * characters), whose literal colors and lengths are CSS that no lint sees. The base theme's
 * `&light` rules weigh as much as these, which come later; beuve declares no dark theme, so its
 * `&dark` rules never apply, and the tokens follow `color-scheme` instead.
 * Tokens read the highlighter's `--diffs-token-*` properties, as a diff's spans do; the themes give
 * light and dark the same weight and slant (ADR 0119), so the light ones serve both.
 */
export const suggestionEditorTheme = EditorView.theme({
  '&': {
    boxSizing: 'border-box',
    maxBlockSize: 'var(--beuve-size-note-editor-max)',
    borderWidth: 'var(--beuve-border-width)',
    borderStyle: 'solid',
    borderColor: 'var(--beuve-border)',
    borderRadius: 'var(--beuve-radius-small)',
    backgroundColor: 'var(--beuve-code-bg)',
    color: 'var(--beuve-code-text)',
    fontSize: 'var(--beuve-font-size-code)',
  },
  '&.cm-focused': {
    borderColor: 'var(--beuve-accent)',
    outline: 'none',
  },
  '.cm-scroller': {
    fontFamily: 'var(--beuve-font-family-code)',
    lineHeight: 'var(--beuve-line-height-code)',
    overflowBlock: 'auto',
  },
  '.cm-content': {
    paddingBlock: 'var(--beuve-space-1)',
    paddingInline: '0',
    caretColor: 'var(--beuve-code-text)',
  },
  '.cm-line': { paddingInline: 'var(--beuve-space-2)' },
  '.cm-cursor, .cm-dropCursor': {
    borderInlineStartWidth: 'var(--beuve-border-width-thick)',
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: 'var(--beuve-code-text)',
    marginInlineStart: 'calc(var(--beuve-border-width-thick) / -2)',
  },
  '.cm-selectionBackground': { background: 'var(--beuve-code-selection-match)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    background: 'var(--beuve-diff-selection-bg)',
  },
  '.cm-specialChar': { color: 'var(--beuve-danger)' },
  '.beuve-token': {
    color: 'light-dark(var(--diffs-token-light), var(--diffs-token-dark))',
    fontWeight: 'var(--diffs-token-light-font-weight, inherit)',
    fontStyle: 'var(--diffs-token-light-font-style, inherit)',
  },
});
