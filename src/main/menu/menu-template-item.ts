import type { MenuIcon } from '#contract/command-catalog.ts';

/**
 * A menu item as plain data, shaped like Electron's `MenuItemConstructorOptions` without `click`:
 * `createAppMenus` adds the clicks. Ids are catalog ids; a hidden alternate key's item is
 * `<id>~<n>`.
 */
export interface MenuTemplateItem {
  readonly id?: string;
  readonly label?: string;
  /**
   * The label while the window reports the command checked, for a command with `checkedNames`
   * (ADR 0143): `createAppMenus` swaps the two in place and leaves it out of Electron's options.
   */
  readonly checkedLabel?: string;
  /** The symbol beside the label (ADR 0143); `createAppMenus` turns it into an image. */
  readonly icon?: MenuIcon;
  readonly role?: MenuRole;
  readonly type?: 'separator' | 'checkbox' | 'radio';
  readonly accelerator?: string;
  readonly visible?: false;
  readonly registerAccelerator?: false;
  readonly submenu?: readonly MenuTemplateItem[];
}

/** The Electron roles the menus use. */
export type MenuRole =
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'selectAll'
  | 'services'
  | 'hide'
  | 'hideOthers'
  | 'unhide'
  | 'quit'
  | 'close'
  | 'minimize'
  | 'zoom'
  | 'front'
  | 'resetZoom'
  | 'zoomIn'
  | 'zoomOut'
  | 'togglefullscreen'
  | 'toggleDevTools'
  | 'appMenu'
  | 'windowMenu'
  | 'help';
