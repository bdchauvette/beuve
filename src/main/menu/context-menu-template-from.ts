import { acceleratorsFor } from '#contract/accelerators-for.ts';
import type { CatalogCommand, KeyPlatform, TopMenu } from '#contract/command-catalog.ts';
import { contextMenuLayouts } from '#contract/context-menu-layouts.ts';
import type {
  ContextMenuCommand,
  ContextMenuLayout,
  ContextSubmenu,
} from '#contract/context-menu-layouts.ts';

import { joinMenuSections } from './join-menu-sections.ts';
import type { MenuTemplateItem } from './menu-template-item.ts';
import { placeOfCommand } from './place-of-command.ts';

const menuOrder: readonly TopMenu[] = [
  'app',
  'file',
  'edit',
  'view',
  'go',
  'review',
  'chat',
  'window',
  'help',
];

/**
 * The context menu of `kind` from the catalog (ADR 0068): the commands that list it, grouped by
 * their menu and group, or in the order of the kind's layout when it has one (ADR 0150), with
 * their first accelerator shown but not registered. `text` is the editing menu of a text field.
 * Pure.
 */
export function contextMenuTemplateFrom(
  catalog: readonly CatalogCommand[],
  kind: string,
  platform: KeyPlatform,
): readonly MenuTemplateItem[] {
  if (kind === 'text') {
    return joinMenuSections([
      [{ role: 'undo' }, { role: 'redo' }],
      [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
    ]);
  }
  const layout = contextMenuLayouts[kind as keyof typeof contextMenuLayouts];
  if (layout !== undefined) {
    return laidOutItems(layout, { catalog, platform });
  }
  const chosen = catalog.filter((command) => {
    return (command.context as readonly string[] | undefined)?.includes(kind) === true;
  });
  const sectionOf = (command: CatalogCommand): number => {
    const place = placeOfCommand(command, platform);
    if (place === undefined) {
      return Number.MAX_SAFE_INTEGER;
    }
    return menuOrder.indexOf(place.menu) * 100 + place.group;
  };
  const sections = [...new Set(chosen.map((command) => sectionOf(command)))].toSorted(
    (left, right) => {
      return left - right;
    },
  );
  return joinMenuSections(
    sections.map((section) => {
      return chosen
        .filter((command) => sectionOf(command) === section)
        .map((command) => contextItem(command, platform));
    }),
  );
}

function contextItem(command: CatalogCommand, platform: KeyPlatform): MenuTemplateItem {
  const [accelerator] = acceleratorsFor(command, platform);
  return {
    id: command.id,
    label: command.title,
    ...(command.checkedNames !== undefined && { checkedLabel: command.checkedNames.title }),
    ...(command.toggle !== undefined && { type: command.toggle }),
    ...(command.icon !== undefined && { icon: command.icon }),
    ...(accelerator !== undefined && { accelerator, registerAccelerator: false }),
  };
}

/** The catalog to look commands up in, and the platform whose keys to show. */
interface LayoutSource {
  readonly catalog: readonly CatalogCommand[];
  readonly platform: KeyPlatform;
}

function laidOutItems(
  sections: ContextMenuLayout | ContextSubmenu['sections'],
  source: LayoutSource,
): readonly MenuTemplateItem[] {
  return joinMenuSections(
    sections.map((section) => {
      return section.flatMap((entry) => {
        if ('submenu' in entry) {
          return { label: entry.submenu, submenu: laidOutItems(entry.sections, source) };
        }
        return laidOutCommand(entry, source);
      });
    }),
  );
}

/** A laid-out command with its short label and no icon; nothing for an id the catalog lacks. */
function laidOutCommand(
  entry: ContextMenuCommand,
  { catalog, platform }: LayoutSource,
): MenuTemplateItem[] {
  const command = catalog.find((candidate) => candidate.id === entry.id);
  if (command === undefined) {
    return [];
  }
  const [accelerator] = acceleratorsFor(command, platform);
  const toggle = entry.toggle ?? command.toggle;
  let checkedLabel: string | undefined;
  if (entry.toggle === undefined) {
    checkedLabel = command.checkedNames?.label ?? command.checkedNames?.title;
  }
  return [
    {
      id: command.id,
      label: entry.label ?? command.label ?? command.title,
      ...(checkedLabel !== undefined && { checkedLabel }),
      ...(toggle !== undefined && { type: toggle }),
      ...(accelerator !== undefined && { accelerator, registerAccelerator: false }),
    },
  ];
}
