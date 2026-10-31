import { acceleratorsFor } from '#contract/accelerators-for.ts';
import type { CatalogCommand, KeyPlatform, TopMenu } from '#contract/command-catalog.ts';

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
 * their menu and group, with their first accelerator shown but not registered. `text` is the editing menu
 * of a text field. Pure.
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
  const chosen = catalog.filter((command) => {
    return (command.context as readonly string[] | undefined)?.includes(kind) === true;
  });
  const sectionOf = (command: CatalogCommand): number => {
    const place = placeOfCommand(command, platform);
    return place === undefined
      ? Number.MAX_SAFE_INTEGER
      : menuOrder.indexOf(place.menu) * 100 + place.group;
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
    ...(command.toggle !== undefined && { type: command.toggle }),
    ...(accelerator !== undefined && { accelerator, registerAccelerator: false }),
  };
}
