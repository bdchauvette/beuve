import { nativeTheme } from 'electron';

/** A window's background colors, shown before the page paints. */
export interface WindowPalette {
  readonly dark: string;
  readonly light: string;
}

/** The palette's color for the system's current light or dark appearance. */
export function windowBackground(palette: WindowPalette): string {
  if (nativeTheme.shouldUseDarkColors) {
    return palette.dark;
  }
  return palette.light;
}
