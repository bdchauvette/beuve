import type { CommandId, ContextKind } from './command-catalog.ts';

/**
 * One command in a laid-out context menu. `label` and `toggle` override the catalog's for this
 * menu only: Mark Note as Blocking reads "Blocking" with a check mark in the Label submenu.
 */
export interface ContextMenuCommand {
  readonly id: CommandId;
  readonly label?: string;
  readonly toggle?: 'checkbox';
}

/** A submenu of a laid-out context menu, in sections a separator divides. */
export interface ContextSubmenu {
  readonly submenu: string;
  readonly sections: readonly (readonly ContextMenuCommand[])[];
}

/** A context menu in sections a separator divides, top to bottom (ADR 0150). */
export type ContextMenuLayout = readonly (readonly (ContextMenuCommand | ContextSubmenu)[])[];

/**
 * Context menus laid out by hand (ADR 0150). A kind listed here gets exactly these commands in
 * this order, and every command whose `context` names the kind must appear (a test holds both
 * ways); any other kind is grouped by the commands' menu-bar places. Labels are the catalog's
 * short `label`s, since the menu already says what it acts on. The note's menu goes from looking,
 * to changing, to concluding, to ordering, with Delete last on its own.
 */
export const contextMenuLayouts: Readonly<Partial<Record<ContextKind, ContextMenuLayout>>> = {
  note: [
    [{ id: 'note-show' }, { id: 'open-in-editor' }],
    [
      { id: 'note-edit' },
      {
        submenu: 'Label',
        sections: [
          [
            { id: 'note-label-issue' },
            { id: 'note-label-suggestion' },
            { id: 'note-label-question' },
            { id: 'note-label-nitpick' },
            { id: 'note-label-thought' },
            { id: 'note-label-smell' },
            { id: 'note-label-praise' },
            { id: 'note-label-note' },
            { id: 'note-label-todo' },
            { id: 'note-label-chore' },
          ],
          [{ id: 'note-blocking', label: 'Blocking', toggle: 'checkbox' }],
        ],
      },
    ],
    [
      {
        submenu: 'Status',
        sections: [
          [{ id: 'note-status-open' }],
          [{ id: 'note-status-addressed' }, { id: 'note-status-withdrawn' }],
        ],
      },
    ],
    [{ id: 'note-move-up' }, { id: 'note-move-down' }],
    [{ id: 'add-to-chat' }],
    [{ id: 'note-delete' }],
  ],
};
