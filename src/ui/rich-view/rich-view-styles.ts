import { css } from 'lit';

import { buttonStyles } from '../primitives/button-styles.ts';

/**
 * How a rich view looks (ADR 0123): a document in the prose font (ADR 0124) at reading size, a margin
 * on the start side for the note button, and regions tinted by status: added and removed in
 * the diff colors, modified in the accent, the selected regions outlined.
 */
export const richViewStyles = [
  buttonStyles,
  css`
    :host {
      display: block;
    }

    .frame {
      position: relative;
      padding-block: var(--beuve-space-3);
      padding-inline: var(--beuve-space-8) var(--beuve-space-4);
    }

    .document {
      max-inline-size: var(--beuve-size-reading);
      font: var(--beuve-font-prose);
      color: var(--beuve-text);
      overflow-wrap: anywhere;
    }

    .failure {
      color: var(--beuve-text-muted);
    }

    .document :is(p, ul, ol, dl, blockquote, table, pre, details, hr, figure) {
      margin-block: 0 var(--beuve-space-3);
    }

    /* IBM Plex Sans is bundled at 400 and 600 (ADR 0124): bold text takes the semibold face. */
    .document :is(strong, b, dt) {
      font-weight: var(--beuve-font-weight-semibold);
    }

    .document :is(h1, h2, h3, h4, h5, h6) {
      margin-block: var(--beuve-space-4) var(--beuve-space-2);
      font-weight: var(--beuve-font-weight-semibold);
      line-height: var(--beuve-line-height-tight);
    }

    .document h1 {
      padding-block-end: var(--beuve-space-1);
      border-block-end: var(--beuve-border-width) solid var(--beuve-border);
      font-size: var(--beuve-font-size-prose-h1);
    }

    .document h2 {
      padding-block-end: var(--beuve-space-1);
      border-block-end: var(--beuve-border-width) solid var(--beuve-border);
      font-size: var(--beuve-font-size-prose-h2);
    }

    .document h3 {
      font-size: var(--beuve-font-size-prose-h3);
    }

    .document :is(h4, h5, h6) {
      font-size: inherit;
    }

    .document :is(ul, ol) {
      padding-inline-start: var(--beuve-space-6);
    }

    .document li[data-task] {
      list-style: none;
    }

    .document li[data-task]::before {
      margin-inline: calc(-1 * var(--beuve-space-4)) var(--beuve-space-1);
      content: '☐';
    }

    .document li[data-task='done']::before {
      content: '☑';
    }

    .document blockquote {
      margin-inline: 0;
      padding-inline-start: var(--beuve-space-3);
      border-inline-start: var(--beuve-border-width-heavy) solid var(--beuve-border);
      color: var(--beuve-text-muted);
    }

    .document blockquote[data-alert] {
      color: var(--beuve-text);
    }

    .document blockquote[data-alert]::before {
      display: block;
      font-weight: var(--beuve-font-weight-semibold);
    }

    .document blockquote[data-alert='note'] {
      border-color: var(--beuve-accent);
    }

    .document blockquote[data-alert='note']::before {
      color: var(--beuve-accent);
      content: 'Note';
    }

    .document blockquote[data-alert='tip'] {
      border-color: var(--beuve-ok);
    }

    .document blockquote[data-alert='tip']::before {
      color: var(--beuve-ok);
      content: 'Tip';
    }

    .document blockquote[data-alert='important'] {
      border-color: var(--beuve-violet);
    }

    .document blockquote[data-alert='important']::before {
      color: var(--beuve-violet);
      content: 'Important';
    }

    .document blockquote[data-alert='warning'] {
      border-color: var(--beuve-warn);
    }

    .document blockquote[data-alert='warning']::before {
      color: var(--beuve-warn);
      content: 'Warning';
    }

    .document blockquote[data-alert='caution'] {
      border-color: var(--beuve-danger);
    }

    .document blockquote[data-alert='caution']::before {
      color: var(--beuve-danger);
      content: 'Caution';
    }

    .document table {
      display: block;
      max-inline-size: 100%;
      overflow-inline: auto;
      border-collapse: collapse;
    }

    .document :is(th, td) {
      padding: var(--beuve-space-1) var(--beuve-space-2);
      border: var(--beuve-border-width) solid var(--beuve-border);
      text-align: start;
      vertical-align: top;
    }

    .document th {
      background: var(--beuve-surface-sunken);
      font-weight: var(--beuve-font-weight-semibold);
    }

    .document :is(th, td)[align='center'] {
      text-align: center;
    }

    .document :is(th, td)[align='right'] {
      text-align: end;
    }

    .document code,
    .document kbd,
    .document samp {
      padding: 0 var(--beuve-space-0-5);
      border-radius: var(--beuve-radius-small);
      background: var(--beuve-surface-sunken);
      font: var(--beuve-font-code);
      font-size: var(--beuve-font-size-mark);
    }

    .document kbd {
      border: var(--beuve-border-width) solid var(--beuve-border);
    }

    .document pre {
      padding: var(--beuve-space-2) var(--beuve-space-3);
      overflow: auto;
      border-radius: var(--beuve-radius);
      background: var(--beuve-code-bg);
      color: var(--beuve-code-text);
      font: var(--beuve-font-code);
    }

    .document pre code {
      padding: 0;
      background: none;
      font-size: inherit;
    }

    .document pre.highlighted,
    .document pre.diagram-frame {
      padding: 0;
      white-space: normal;
    }

    .document pre.diagram-frame {
      background: none;
    }

    .document img {
      max-inline-size: 100%;
      block-size: auto;
    }

    .document img.diagram {
      display: block;
    }

    .document .image-placeholder {
      display: inline-block;
      padding: 0 var(--beuve-space-1);
      border: var(--beuve-border-width) dashed var(--beuve-border);
      border-radius: var(--beuve-radius-small);
      color: var(--beuve-text-muted);
      font: var(--beuve-font-small);
    }

    .document .diagram-error {
      margin-block: calc(-1 * var(--beuve-space-2)) var(--beuve-space-3);
      color: var(--beuve-danger);
      font: var(--beuve-font-small);
    }

    .document details > summary {
      cursor: pointer;
    }

    .document hr {
      border: none;
      border-block-start: var(--beuve-border-width-thick) solid var(--beuve-border);
    }

    .document section {
      color: var(--beuve-text-muted);
      font: var(--beuve-font-small);
    }

    .document a[data-action='link'] {
      color: var(--beuve-accent);
      text-decoration: underline;
      cursor: pointer;
    }

    .document a[data-action='link']:focus-visible {
      outline: var(--beuve-focus-ring);
      outline-offset: var(--beuve-focus-ring-offset);
    }

    .document [data-status] {
      border-radius: var(--beuve-radius-small);
    }

    .document [data-status='added'] {
      background: var(--beuve-diff-added-bg);
      box-shadow: calc(-1 * var(--beuve-space-2)) 0 0 var(--beuve-diff-added-bg);
    }

    .document [data-status='modified'] {
      box-shadow: calc(-1 * var(--beuve-space-2)) 0 0 var(--beuve-accent-soft);
    }

    .document [data-status='removed'] {
      background: var(--beuve-diff-removed-bg);
      box-shadow: calc(-1 * var(--beuve-space-2)) 0 0 var(--beuve-diff-removed-bg);
      color: var(--beuve-diff-removed-text);
    }

    .document [data-status] [data-status] {
      box-shadow: none;
    }

    .document [data-selected] {
      outline: var(--beuve-border-width-thick) solid var(--beuve-accent);
      outline-offset: var(--beuve-space-0-5);
    }

    .document .previous {
      margin-block-end: var(--beuve-space-3);
      padding: var(--beuve-space-2);
    }

    .document .previous-toggle {
      display: block;
      margin-block: calc(-1 * var(--beuve-space-2)) var(--beuve-space-3);
      padding: 0;
      border: none;
      background: none;
      color: var(--beuve-text-muted);
      font: var(--beuve-font-small);
      cursor: pointer;
    }

    .document .previous-toggle:hover {
      color: var(--beuve-accent);
    }

    /* Notes are the interface's, not the document's (ADR 0124). */
    .document .annotation {
      margin-block-end: var(--beuve-space-3);
      font: var(--beuve-font-body);
    }

    .note-button {
      position: absolute;
      position-anchor: --beuve-rich-hovered;
      inset-block-start: anchor(start);
      inset-inline-start: var(--beuve-space-2);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      inline-size: var(--beuve-size-control-small);
      block-size: var(--beuve-size-control-small);
      padding: 0;
      border: var(--beuve-border-width) solid var(--beuve-border);
      border-radius: var(--beuve-radius-small);
      background: var(--beuve-surface);
      color: var(--beuve-accent);
      cursor: pointer;
    }

    .note-button:hover {
      background: var(--beuve-accent-soft);
    }
  `,
];
