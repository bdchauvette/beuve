import { htmlStructureFrom } from './html-structure-from.ts';
import { inParsedText } from './in-parsed-text.ts';

/** The text a browser shows for `html`, outside raw-text elements such as `<style>`. */
export function visibleText(html: readonly string[]): string {
  return inParsedText(htmlStructureFrom(html.join('')).text);
}
