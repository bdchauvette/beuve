/** The extended SQLite result code of a `node:sqlite` error, e.g. 2067 for UNIQUE. */
export function sqliteErrorCode(error: unknown): number | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'errcode' in error &&
    typeof error.errcode === 'number'
  ) {
    return error.errcode;
  }
  return undefined;
}
