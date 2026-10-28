/**
 * LSP `PositionEncodingKind` values, as the protocol spells them on the wire. Use these instead of
 * string literals.
 */
export const positionEncodings = Object.freeze({
  // eslint-disable-next-line unicorn/text-encoding-identifier-case -- the LSP wire value is 'utf-8'.
  utf8: 'utf-8',
  utf16: 'utf-16',
  utf32: 'utf-32',
} as const);
