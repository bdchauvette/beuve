/** The menu bar's top-level menus (ADR 0068). `app` exists on macOS only. */
export type TopMenu =
  'app' | 'file' | 'edit' | 'view' | 'go' | 'review' | 'chat' | 'window' | 'help';

/** What a right-click lands on: a diff line or selection, a file header, a tree row, … */
export type ContextKind = 'line' | 'file' | 'tree' | 'note' | 'answer' | 'sheet';

/** The windows beuve opens; a command runs only in the kinds it lists. */
export type WindowKind = 'main' | 'sheet' | 'settings';

/** The two keyboard layouts: macOS, and Linux (also used for any other platform). */
export type KeyPlatform = 'mac' | 'linux';

/**
 * What a window reports about itself (`menu:set-state`) so main can enable menu items. A command
 * is enabled when every condition in its `when` holds; `text-focus` suspends `textConflict` ones.
 */
export type MenuCondition =
  | 'session'
  | 'file'
  | 'diff-target'
  | 'dock-item'
  | 'busy'
  | 'pull-request'
  | 'staged'
  | 'back'
  | 'forward'
  | 'text-focus'
  | 'terminal-focus';

/** Where a command sits in the menu bar; items sort by `group`, then catalog order. */
export interface MenuPlace {
  readonly menu: TopMenu;
  readonly group: number;
  /** A submenu of `menu`, created at the place of its first item. */
  readonly submenu?: string;
  /** Separators inside the submenu. */
  readonly subgroup?: number;
}

/** Electron accelerator strings per platform; `…Alt` ones become hidden menu items. */
export interface CommandKeys {
  readonly mac?: string;
  readonly linux?: string;
  readonly macAlt?: readonly string[];
  readonly linuxAlt?: readonly string[];
}

/** Keys that work only where the focus is (a list, an input); never menu accelerators. */
export interface InPlaceKeys {
  readonly area: 'Review notes' | 'Chat' | 'Portals' | 'Sheets' | 'Files and lists';
  readonly keys: readonly string[];
}

export interface CatalogCommand {
  readonly id: string;
  /** What the palette and the shortcuts window call it. */
  readonly title: string;
  /** The menu label when it differs from `title` (inside a submenu that already names the topic). */
  readonly label?: string;
  readonly menu?: MenuPlace;
  /** The place on Linux when it differs (Linux has no app menu). */
  readonly linuxMenu?: MenuPlace;
  /** The label on Linux when it differs (Preferences instead of Settings). */
  readonly linuxLabel?: string;
  readonly keys?: CommandKeys;
  readonly inPlace?: InPlaceKeys;
  /** The chord means something in a text field, so it is suspended while one has focus. */
  readonly textConflict?: true;
  /**
   * The chord still works while a terminal has the keyboard (ADR 0095). Every other keyed command
   * is disabled then on Linux, where its Ctrl chord is a shell's (Ctrl-D, Ctrl-R, Ctrl-K).
   */
  readonly keepsInTerminal?: true;
  /**
   * With no main window open (macOS keeps the app running after the last one closes), choosing it
   * opens a main window and runs the command there, whatever window has focus.
   */
  readonly opensMainWindow?: true;
  readonly when?: readonly MenuCondition[];
  readonly toggle?: 'checkbox' | 'radio';
  readonly context?: readonly ContextKind[];
  readonly windows: readonly WindowKind[];
  /** `main` runs it in the main process; `window` sends `menu:run` to the focused window. */
  readonly handler: 'main' | 'window';
}

const entries = Object.freeze([
  // beuve (macOS app menu); Linux puts these in Help and Edit.
  {
    id: 'about',
    title: 'About beuve',
    menu: { menu: 'app', group: 0 },
    linuxMenu: { menu: 'help', group: 9 },
    windows: everywhere(),
    handler: 'main',
  },
  {
    id: 'settings',
    title: 'Settings…',
    linuxLabel: 'Preferences…',
    menu: { menu: 'app', group: 1 },
    linuxMenu: { menu: 'edit', group: 9 },
    keys: { mac: 'Cmd+,', linux: 'Ctrl+,' },
    windows: everywhere(),
    handler: 'main',
  },
  // File
  {
    id: 'open',
    title: 'Open Pull Request or Branch…',
    menu: { menu: 'file', group: 0 },
    keys: { mac: 'Cmd+O', linux: 'Ctrl+O' },
    opensMainWindow: true,
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'export-agent-xml',
    title: 'Copy Review for Claude Code (XML)',
    label: 'Copy for Claude Code (XML)',
    menu: { menu: 'file', group: 1, submenu: 'Export Review' },
    when: ['session'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'export-agent-json',
    title: 'Copy Review for Agents (JSON)',
    label: 'Copy for Agents (JSON)',
    menu: { menu: 'file', group: 1, submenu: 'Export Review' },
    when: ['session'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'export-github',
    title: 'Copy GitHub Review (JSON)',
    label: 'Copy GitHub Review (JSON)',
    menu: { menu: 'file', group: 1, submenu: 'Export Review' },
    when: ['session'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'post-review',
    title: 'Post Review to GitHub…',
    menu: { menu: 'file', group: 1 },
    when: ['pull-request', 'staged'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'close-all-sheets',
    title: 'Close All Sheets',
    menu: { menu: 'file', group: 2 },
    keys: { mac: 'Alt+Cmd+W' },
    windows: everywhere(),
    handler: 'main',
  },
  // Edit
  {
    id: 'copy-permalink',
    title: 'Copy GitHub Permalink',
    menu: { menu: 'edit', group: 2 },
    keys: { mac: 'Shift+Cmd+C', linux: 'Ctrl+Shift+C' },
    context: ['line', 'file', 'sheet'],
    when: ['file'],
    windows: ['main', 'sheet'],
    handler: 'window',
  },
  {
    id: 'copy-relative-line',
    title: 'Copy Relative Line Number',
    menu: { menu: 'edit', group: 2 },
    keys: { mac: 'Alt+Shift+Cmd+C', linux: 'Ctrl+Alt+Shift+C' },
    context: ['line', 'file'],
    when: ['file'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'find',
    title: 'Find…',
    menu: { menu: 'edit', group: 3, submenu: 'Find' },
    keys: { mac: 'Cmd+F', linux: 'Ctrl+F' },
    when: ['session'],
    windows: ['main', 'sheet'],
    handler: 'window',
  },
  {
    id: 'find-next',
    title: 'Find Next',
    menu: { menu: 'edit', group: 3, submenu: 'Find' },
    keys: { mac: 'Cmd+G', linux: 'Ctrl+G' },
    when: ['session'],
    windows: ['main', 'sheet'],
    handler: 'window',
  },
  {
    id: 'find-previous',
    title: 'Find Previous',
    menu: { menu: 'edit', group: 3, submenu: 'Find' },
    keys: { mac: 'Shift+Cmd+G', linux: 'Ctrl+Shift+G' },
    when: ['session'],
    windows: ['main', 'sheet'],
    handler: 'window',
  },
  {
    id: 'find-selection',
    title: 'Use Selection for Find',
    menu: { menu: 'edit', group: 3, submenu: 'Find' },
    keys: { mac: 'Cmd+E' },
    when: ['session'],
    windows: ['main', 'sheet'],
    handler: 'window',
  },
  {
    id: 'find-match-case',
    title: 'Match Case in Find',
    label: 'Match Case',
    menu: { menu: 'edit', group: 3, submenu: 'Find', subgroup: 1 },
    keys: { mac: 'Alt+Cmd+C' },
    toggle: 'checkbox',
    when: ['session'],
    windows: ['main'],
    handler: 'window',
  },
  // View
  {
    id: 'palette',
    title: 'Command Palette…',
    menu: { menu: 'view', group: 0 },
    keys: { mac: 'Cmd+K', linux: 'Ctrl+K', macAlt: ['Shift+Cmd+P'], linuxAlt: ['Ctrl+Shift+P'] },
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'toggle-sidebar',
    title: 'Show Sidebar',
    menu: { menu: 'view', group: 1, submenu: 'Sidebar' },
    keys: { mac: 'Ctrl+Cmd+S', linux: 'F9' },
    toggle: 'checkbox',
    when: ['session'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'sidebar-overview',
    title: 'Show Intent & Files',
    label: 'Intent & Files',
    menu: { menu: 'view', group: 1, submenu: 'Sidebar', subgroup: 1 },
    keys: { mac: 'Cmd+1', linux: 'Ctrl+1' },
    when: ['session'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'sidebar-review',
    title: 'Show Review Notes',
    label: 'Review',
    menu: { menu: 'view', group: 1, submenu: 'Sidebar', subgroup: 1 },
    keys: { mac: 'Cmd+2', linux: 'Ctrl+2' },
    when: ['session'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'sidebar-chat',
    title: 'Show Chat',
    label: 'Chat',
    menu: { menu: 'view', group: 1, submenu: 'Sidebar', subgroup: 1 },
    keys: { mac: 'Cmd+3', linux: 'Ctrl+3' },
    when: ['session'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'sidebar-left',
    title: 'Sidebar on the Left',
    label: 'On the Left',
    menu: { menu: 'view', group: 1, submenu: 'Sidebar', subgroup: 2 },
    toggle: 'radio',
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'sidebar-right',
    title: 'Sidebar on the Right',
    label: 'On the Right',
    menu: { menu: 'view', group: 1, submenu: 'Sidebar', subgroup: 2 },
    toggle: 'radio',
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'flip-sidebar',
    title: 'Move the Sidebar to the Other Side',
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'diff-split',
    title: 'Diffs Side by Side',
    label: 'Side by Side',
    menu: { menu: 'view', group: 2, submenu: 'Diff' },
    toggle: 'radio',
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'diff-inline',
    title: 'Diffs Inline',
    label: 'Inline',
    menu: { menu: 'view', group: 2, submenu: 'Diff' },
    toggle: 'radio',
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'whitespace',
    title: 'Hide Whitespace Changes',
    menu: { menu: 'view', group: 2, submenu: 'Diff', subgroup: 1 },
    toggle: 'checkbox',
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'toggle-generated',
    title: 'Show Generated Files',
    menu: { menu: 'view', group: 2, submenu: 'Diff', subgroup: 1 },
    toggle: 'checkbox',
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'toggle-insights',
    title: 'Show Review Insights',
    menu: { menu: 'view', group: 2, submenu: 'Diff', subgroup: 1 },
    toggle: 'checkbox',
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'toggle-terminal',
    title: 'Show Terminal',
    menu: { menu: 'view', group: 3 },
    keys: { mac: 'Ctrl+`', linux: 'Ctrl+`' },
    toggle: 'checkbox',
    keepsInTerminal: true,
    when: ['session'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'tree-mode',
    title: 'Changed Files Only',
    menu: { menu: 'view', group: 3 },
    toggle: 'checkbox',
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'order-path',
    title: 'Order Files by Path',
    label: 'Path',
    menu: { menu: 'view', group: 3, submenu: 'Order Files By' },
    toggle: 'radio',
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'order-imports',
    title: 'Order Files by Imports',
    label: 'Imports',
    menu: { menu: 'view', group: 3, submenu: 'Order Files By' },
    toggle: 'radio',
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'order-calls',
    title: 'Order Files by Calls',
    label: 'Calls',
    menu: { menu: 'view', group: 3, submenu: 'Order Files By' },
    toggle: 'radio',
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'sheets-window',
    title: 'Open Definitions in Sheet Windows',
    label: 'Sheet Windows',
    menu: { menu: 'view', group: 3, submenu: 'Open Definitions In' },
    toggle: 'radio',
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'sheets-inline',
    title: 'Open Definitions over the Diff',
    label: 'Over the Diff',
    menu: { menu: 'view', group: 3, submenu: 'Open Definitions In' },
    toggle: 'radio',
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'expand',
    title: 'Expand File',
    menu: { menu: 'view', group: 4 },
    keys: { mac: 'Alt+Cmd+Right', linux: 'Ctrl+Shift+]' },
    context: ['file'],
    when: ['file'],
    textConflict: true,
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'collapse',
    title: 'Collapse File',
    menu: { menu: 'view', group: 4 },
    keys: { mac: 'Alt+Cmd+Left', linux: 'Ctrl+Shift+[' },
    context: ['file'],
    when: ['file'],
    textConflict: true,
    windows: ['main'],
    handler: 'window',
  },
  // Go
  {
    id: 'back',
    title: 'Back',
    menu: { menu: 'go', group: 0 },
    keys: { mac: 'Cmd+[', linux: 'Alt+Left' },
    when: ['back'],
    textConflict: true,
    windows: ['main', 'sheet'],
    handler: 'window',
  },
  {
    id: 'forward',
    title: 'Forward',
    menu: { menu: 'go', group: 0 },
    keys: { mac: 'Cmd+]', linux: 'Alt+Right' },
    when: ['forward'],
    textConflict: true,
    windows: ['main', 'sheet'],
    handler: 'window',
  },
  {
    id: 'next-hunk',
    title: 'Next Change',
    menu: { menu: 'go', group: 1 },
    keys: { mac: 'Cmd+Down', linux: 'Alt+Down', macAlt: ['F7'], linuxAlt: ['F7'] },
    when: ['session'],
    textConflict: true,
    windows: ['main', 'sheet'],
    handler: 'window',
  },
  {
    id: 'previous-hunk',
    title: 'Previous Change',
    menu: { menu: 'go', group: 1 },
    keys: { mac: 'Cmd+Up', linux: 'Alt+Up', macAlt: ['Shift+F7'], linuxAlt: ['Shift+F7'] },
    when: ['session'],
    textConflict: true,
    windows: ['main', 'sheet'],
    handler: 'window',
  },
  {
    id: 'next-file',
    title: 'Next File',
    menu: { menu: 'go', group: 1 },
    keys: { mac: 'Alt+Cmd+Down', linux: 'Ctrl+PageDown' },
    when: ['session'],
    textConflict: true,
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'previous-file',
    title: 'Previous File',
    menu: { menu: 'go', group: 1 },
    keys: { mac: 'Alt+Cmd+Up', linux: 'Ctrl+PageUp' },
    when: ['session'],
    textConflict: true,
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'toggle-skip-reviewed',
    title: 'Skip Reviewed Files',
    menu: { menu: 'go', group: 1 },
    toggle: 'checkbox',
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'go-to-file',
    title: 'Go to File…',
    menu: { menu: 'go', group: 2 },
    keys: { mac: 'Cmd+P', linux: 'Ctrl+P' },
    when: ['session'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'open-definition',
    title: 'Go to Definition',
    menu: { menu: 'go', group: 2 },
    keys: { mac: 'Cmd+B', linux: 'Ctrl+B', macAlt: ['F12'], linuxAlt: ['F12'] },
    context: ['line', 'sheet'],
    when: ['file'],
    windows: ['main', 'sheet'],
    handler: 'window',
  },
  {
    id: 'open-type-definition',
    title: 'Go to Type Definition',
    menu: { menu: 'go', group: 2 },
    keys: { mac: 'Shift+Cmd+B', linux: 'Ctrl+Shift+B' },
    context: ['line', 'sheet'],
    when: ['file'],
    windows: ['main', 'sheet'],
    handler: 'window',
  },
  {
    id: 'cycle-zone',
    title: 'Next Region',
    menu: { menu: 'go', group: 3 },
    keys: { mac: 'Ctrl+Tab', linux: 'F6', macAlt: ['F6'], linuxAlt: ['Ctrl+Tab'] },
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'cycle-zone-back',
    title: 'Previous Region',
    menu: { menu: 'go', group: 3 },
    keys: {
      mac: 'Ctrl+Shift+Tab',
      linux: 'Shift+F6',
      macAlt: ['Shift+F6'],
      linuxAlt: ['Ctrl+Shift+Tab'],
    },
    windows: ['main'],
    handler: 'window',
  },
  // Review
  {
    id: 'toggle-reviewed',
    title: 'File Reviewed',
    menu: { menu: 'review', group: 0 },
    keys: { mac: 'Cmd+D', linux: 'Ctrl+D' },
    toggle: 'checkbox',
    context: ['file', 'tree'],
    when: ['file'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'save-progress',
    title: 'Save Progress',
    menu: { menu: 'review', group: 0 },
    keys: { mac: 'Cmd+S', linux: 'Ctrl+S' },
    when: ['session'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'stage',
    title: 'Add Note',
    menu: { menu: 'review', group: 1 },
    keys: { mac: 'Cmd+/', linux: 'Ctrl+/' },
    context: ['line', 'file'],
    when: ['diff-target'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'suggest-edit',
    title: 'Suggest Edit…',
    menu: { menu: 'review', group: 1 },
    keys: { mac: 'Alt+Cmd+E', linux: 'Ctrl+Shift+E' },
    context: ['line'],
    when: ['diff-target'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'peek',
    title: 'Show Callers',
    menu: { menu: 'review', group: 2 },
    keys: { mac: 'Cmd+I', linux: 'Ctrl+I' },
    context: ['line'],
    when: ['file'],
    textConflict: true,
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'flow',
    title: 'Show Control Flow',
    menu: { menu: 'review', group: 2 },
    keys: { mac: 'Shift+Cmd+I', linux: 'Ctrl+Shift+I' },
    context: ['line'],
    when: ['file'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'stop',
    title: 'Stop',
    menu: { menu: 'review', group: 2 },
    keys: { mac: 'Cmd+.' },
    when: ['busy'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'impact-details',
    title: 'ImpactGate Details',
    menu: { menu: 'review', group: 2 },
    keys: { mac: 'Alt+Cmd+I', linux: 'Alt+Return' },
    context: ['file'],
    when: ['file'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'open-in-editor',
    title: 'Open in Editor',
    menu: { menu: 'review', group: 3 },
    keys: { mac: 'Alt+Cmd+O', linux: 'Ctrl+Shift+O' },
    context: ['line', 'file', 'tree', 'note'],
    when: ['file'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'editor-zed',
    title: 'Open in Zed',
    label: 'Zed',
    menu: { menu: 'review', group: 3, submenu: 'Open With' },
    toggle: 'radio',
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'editor-vscode',
    title: 'Open in VS Code',
    label: 'VS Code',
    menu: { menu: 'review', group: 3, submenu: 'Open With' },
    toggle: 'radio',
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'editor-cursor',
    title: 'Open in Cursor',
    label: 'Cursor',
    menu: { menu: 'review', group: 3, submenu: 'Open With' },
    toggle: 'radio',
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'open-review-edits',
    title: 'Open Review Edits',
    label: 'Open in Editor',
    menu: { menu: 'review', group: 3, submenu: 'Review Edits' },
    context: ['line', 'file', 'tree'],
    when: ['session'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'harvest-review-edits',
    title: 'Turn Review Edits into Suggestions…',
    label: 'Turn into Suggestions…',
    menu: { menu: 'review', group: 3, submenu: 'Review Edits' },
    when: ['session'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'discard-review-edits',
    title: 'Discard Review Edits…',
    label: 'Discard…',
    menu: { menu: 'review', group: 3, submenu: 'Review Edits', subgroup: 1 },
    when: ['session'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'open-permalink',
    title: 'Open on GitHub',
    menu: { menu: 'review', group: 3 },
    context: ['line', 'file', 'sheet'],
    when: ['file'],
    windows: ['main', 'sheet'],
    handler: 'window',
  },
  {
    id: 'commit-pairs',
    title: 'Filter by Commit…',
    menu: { menu: 'review', group: 4 },
    when: ['session'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'dock-show',
    title: 'Show Note in Diff',
    label: 'Show in Diff',
    menu: { menu: 'review', group: 5, submenu: 'Note' },
    inPlace: { area: 'Review notes', keys: ['Return'] },
    context: ['note'],
    when: ['dock-item'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'dock-edit',
    title: 'Edit Note…',
    menu: { menu: 'review', group: 5, submenu: 'Note' },
    inPlace: { area: 'Review notes', keys: ['Space'] },
    context: ['note'],
    when: ['dock-item'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'dock-withdraw',
    title: 'Withdraw or Restore Note',
    label: 'Withdraw or Restore',
    menu: { menu: 'review', group: 5, submenu: 'Note' },
    inPlace: { area: 'Review notes', keys: ['Delete'] },
    context: ['note'],
    when: ['dock-item'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'dock-addressed',
    title: 'Note Addressed',
    label: 'Addressed',
    menu: { menu: 'review', group: 5, submenu: 'Note' },
    toggle: 'checkbox',
    context: ['note'],
    when: ['dock-item'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'dock-move-up',
    title: 'Move Note Up',
    label: 'Move Up',
    menu: { menu: 'review', group: 5, submenu: 'Note', subgroup: 1 },
    inPlace: { area: 'Review notes', keys: ['Alt+Up'] },
    context: ['note'],
    when: ['dock-item'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'dock-move-down',
    title: 'Move Note Down',
    label: 'Move Down',
    menu: { menu: 'review', group: 5, submenu: 'Note', subgroup: 1 },
    inPlace: { area: 'Review notes', keys: ['Alt+Down'] },
    context: ['note'],
    when: ['dock-item'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'dock-move',
    title: 'Next or Previous Note',
    inPlace: { area: 'Review notes', keys: ['Up', 'Down'] },
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'restart-language-servers',
    title: 'Restart Language Servers',
    menu: { menu: 'review', group: 7 },
    when: ['session'],
    windows: ['main'],
    handler: 'window',
  },
  // Chat
  {
    id: 'chat',
    title: 'Focus Chat',
    menu: { menu: 'chat', group: 0 },
    keys: { mac: 'Cmd+L', linux: 'Ctrl+L' },
    when: ['session'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'add-to-chat',
    title: 'Add to Chat',
    menu: { menu: 'chat', group: 0 },
    keys: { mac: 'Cmd+>', linux: 'Ctrl+>' },
    context: ['line', 'file', 'tree', 'note'],
    when: ['session'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'stage-answer',
    title: 'Stage Answer as a Note',
    context: ['answer'],
    when: ['session'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'summarize',
    title: 'Summarize Change',
    menu: { menu: 'chat', group: 1 },
    when: ['session'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'abstract',
    title: 'Abstract of the Change',
    when: ['session'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'review',
    title: 'Review Change',
    menu: { menu: 'chat', group: 1 },
    when: ['session'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'review-paths',
    title: 'Review Only Some Paths…',
    label: 'Only Some Paths…',
    menu: { menu: 'chat', group: 1, submenu: 'Review With' },
    when: ['session'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'review-fresh',
    title: 'Review Again (Fresh Run)',
    label: 'Fresh Run',
    menu: { menu: 'chat', group: 1, submenu: 'Review With' },
    when: ['session'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'review-no-verify',
    title: 'Review Without Verification',
    label: 'No Verification Pass',
    menu: { menu: 'chat', group: 1, submenu: 'Review With' },
    when: ['session'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'review-effort-low',
    title: 'Review with Low Effort',
    label: 'Low Effort',
    menu: { menu: 'chat', group: 1, submenu: 'Review With', subgroup: 1 },
    when: ['session'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'review-effort-medium',
    title: 'Review with Medium Effort',
    label: 'Medium Effort',
    menu: { menu: 'chat', group: 1, submenu: 'Review With', subgroup: 1 },
    when: ['session'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'review-effort-high',
    title: 'Review with High Effort',
    label: 'High Effort',
    menu: { menu: 'chat', group: 1, submenu: 'Review With', subgroup: 1 },
    when: ['session'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'compact-chat',
    title: 'Compact Chat',
    menu: { menu: 'chat', group: 2 },
    when: ['session'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'clear-queue',
    title: 'Clear Chat Queue',
    label: 'Clear Queue',
    menu: { menu: 'chat', group: 2 },
    when: ['session'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'clear-chat',
    title: 'Clear Chat…',
    menu: { menu: 'chat', group: 2 },
    when: ['session'],
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'help',
    title: 'Chat Commands',
    menu: { menu: 'chat', group: 3 },
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'chat-ask',
    title: 'Ask, or Run a Chat Command',
    inPlace: { area: 'Chat', keys: ['Return'] },
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'chat-back',
    title: 'Back to the Diff',
    inPlace: { area: 'Chat', keys: ['Escape'] },
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'chat-pills',
    title: 'Move Between Citations and Answer Buttons',
    inPlace: { area: 'Chat', keys: ['Up', 'Down'] },
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'chat-chips',
    title: 'Select the Context Chip Beside the Caret',
    inPlace: { area: 'Chat', keys: ['Left', 'Right'] },
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'close-portal',
    title: 'Close Callers or Flow',
    inPlace: { area: 'Portals', keys: ['Escape'] },
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'portal-walk',
    title: 'Walk Callers or Flow Steps',
    inPlace: { area: 'Portals', keys: ['Up', 'Down', 'Return'] },
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'sheet-cursor',
    title: 'Move the Sheet’s Line Cursor',
    inPlace: { area: 'Sheets', keys: ['Up', 'Down', 'Home', 'End'] },
    windows: ['sheet'],
    handler: 'window',
  },
  {
    id: 'list-move',
    title: 'Move in the File Tree, Palette and Open Panel',
    inPlace: { area: 'Files and lists', keys: ['Up', 'Down', 'Return', 'Escape'] },
    windows: ['main'],
    handler: 'window',
  },
  // Help
  {
    id: 'shortcuts',
    title: 'Keyboard Shortcuts',
    menu: { menu: 'help', group: 0 },
    keys: { linux: 'Ctrl+?' },
    windows: ['main'],
    handler: 'window',
  },
  {
    id: 'github-home',
    title: 'beuve on GitHub',
    menu: { menu: 'help', group: 1 },
    windows: everywhere(),
    handler: 'main',
  },
] as const satisfies readonly CatalogCommand[]);

/** Every catalog command id. */
export type CommandId = (typeof entries)[number]['id'];

/**
 * Every command beuve has, once (ADR 0068): menu place, keys, context menus, enablement and the
 * windows it runs in. Main builds the menu bar and context menus from it; the renderer's palette,
 * shortcuts window and `/help` read it with `src/ui/command-registry.ts`, which says what each id
 * does there. Data only.
 */
export const commandCatalog: readonly (CatalogCommand & { readonly id: CommandId })[] = entries;

function everywhere(): readonly WindowKind[] {
  return ['main', 'sheet', 'settings'];
}
