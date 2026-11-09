/** The image types a rich view shows (ADR 0123), by media type. */
export type ImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/svg+xml';

const svgRoot = /^<svg[\s/>]/iu;
const byteOrderMark = 0xfe_ff;
const textProbeBytes = 4096;

/**
 * The type of an image from its bytes, never its name (ADR 0123): PNG, JPEG, GIF and WebP by
 * their signatures, SVG by an `<svg` root after any XML declaration, comments and doctype.
 * `undefined` for anything else. Pure.
 */
export function imageTypeFrom(bytes: Uint8Array): ImageType | undefined {
  if (isPrefixOf(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  if (isPrefixOf(bytes, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }
  if (isPrefixOf(bytes, [0x47, 0x49, 0x46, 0x38])) {
    return 'image/gif';
  }
  const isRiff = isPrefixOf(bytes, [0x52, 0x49, 0x46, 0x46]);
  if (isRiff && isPrefixOf(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])) {
    return 'image/webp';
  }
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, textProbeBytes));
  if (svgRoot.test(withoutProlog(text))) {
    return 'image/svg+xml';
  }
  return undefined;
}

function isPrefixOf(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

/** The text after a byte order mark, an XML declaration, comments and a doctype. */
function withoutProlog(text: string): string {
  let rest = text;
  if (rest.codePointAt(0) === byteOrderMark) {
    rest = rest.slice(1);
  }
  for (;;) {
    rest = rest.trimStart();
    const close = prologClose(rest);
    if (close === undefined) {
      return rest;
    }
    const end = rest.indexOf(close);
    if (end === -1) {
      return '';
    }
    rest = rest.slice(end + close.length);
  }
}

/** What closes the prolog part `text` starts with, or `undefined` when it starts none. */
function prologClose(text: string): string | undefined {
  if (text.startsWith('<?')) {
    return '?>';
  }
  if (text.startsWith('<!--')) {
    return '-->';
  }
  if (text.startsWith('<!')) {
    return '>';
  }
  return undefined;
}
