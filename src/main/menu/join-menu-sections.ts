import type { MenuTemplateItem } from './menu-template-item.ts';

/** Joins the non-empty sections of a menu with separators between them. Pure. */
export function joinMenuSections(
  sections: readonly (readonly MenuTemplateItem[])[],
): MenuTemplateItem[] {
  return sections
    .filter((section) => section.length > 0)
    .flatMap((section, index) => {
      return index === 0 ? section : [{ type: 'separator' }, ...section];
    });
}
