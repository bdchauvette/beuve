/** The last two segments of a folder path, e.g. `…/code/notes`; short paths stay whole. Pure. */
export function shortenPath(path: string): string {
  const parts = path.split('/').filter((part) => part !== '');
  if (parts.length <= 2) {
    return path;
  }
  return `…/${parts.slice(-2).join('/')}`;
}
