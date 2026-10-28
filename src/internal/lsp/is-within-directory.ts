import path from 'node:path';

/** Whether absolute `candidate` is `directory` or lies beneath it, judged lexically. */
export function isWithinDirectory(directory: string, candidate: string): boolean {
  const relative = path.relative(directory, candidate);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
