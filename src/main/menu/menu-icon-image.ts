import { nativeImage, nativeTheme } from 'electron';
import type { NativeImage } from 'electron';

import type { KeyPlatform, MenuIcon } from '#contract/command-catalog.ts';

import { drawMenuIcon } from './draw-menu-icon.ts';
import type { MenuIconInk } from './draw-menu-icon.ts';

/** SF Symbols for each icon, which macOS draws in the menu's own color. */
const symbolNames: Readonly<Record<MenuIcon, string>> = {
  'arrow-up': 'arrow.up',
  'arrow-down': 'arrow.down',
};

/** Ink for the Linux bitmaps, which have no template images: light on dark menus, dark on light. */
const darkMenuInk: MenuIconInk = { scale: 2, red: 221, green: 221, blue: 221 };
const lightMenuInk: MenuIconInk = { scale: 2, red: 64, green: 64, blue: 64 };
const templateInk: MenuIconInk = { scale: 2, red: 0, green: 0, blue: 0 };

/**
 * The image of a catalog icon beside a menu item (ADR 0144). macOS gets the SF Symbol sized for a
 * menu (`createMenuSymbol`) as a template image, so it follows the menu's appearance and
 * selection; should the symbol be missing, beuve's own drawing serves as the template. Linux gets
 * beuve's drawing, inked for the current light or dark theme.
 */
export function menuIconImage(icon: MenuIcon, platform: KeyPlatform): NativeImage {
  if (platform === 'mac') {
    const symbol = nativeImage.createMenuSymbol(symbolNames[icon]);
    let image = symbol;
    if (symbol.isEmpty()) {
      image = drawnImage(icon, templateInk);
    }
    image.setTemplateImage(true);
    return image;
  }
  if (nativeTheme.shouldUseDarkColors) {
    return drawnImage(icon, darkMenuInk);
  }
  return drawnImage(icon, lightMenuInk);
}

function drawnImage(icon: MenuIcon, ink: MenuIconInk): NativeImage {
  const bitmap = drawMenuIcon(icon, ink);
  return nativeImage.createFromBitmap(Buffer.from(bitmap.pixels), {
    width: bitmap.width,
    height: bitmap.height,
    scaleFactor: ink.scale,
  });
}
