/** Whether `value` holds a C0 control character (U+0000–U+001F) or DEL (U+007F). */
export function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.codePointAt(index) ?? 0;
    if (code === 0x7f || code < 0x20) {
      return true;
    }
  }
  return false;
}
