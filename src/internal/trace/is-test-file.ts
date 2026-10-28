const testPattern = /(?:^|\/)__tests__\/|\.(?:test|spec)\.[cm]?[jt]sx?$/u;

/** Whether a repository-relative path names a test file by convention (`*.test.ts`, `__tests__/`). */
export function isTestFile(file: string): boolean {
  return testPattern.test(file);
}
