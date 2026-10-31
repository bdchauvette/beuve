/** What `.gitattributes` says about how a path's diff is shown, GitHub style (ADR 0052). */
export interface DiffAttributes {
  /**
   * `linguist-generated`: `true` when set (or set to any value but `false`), `false` when unset
   * (`-linguist-generated`) or `linguist-generated=false`, absent when unspecified.
   */
  readonly generated?: boolean;
  /** `false` when `diff` is unset (`-diff`, git shows no textual diff); absent otherwise. */
  readonly diff?: false;
}

/**
 * Parses `git check-attr -z linguist-generated diff` output (`path NUL attribute NUL value NUL`,
 * repeated) into the paths that have any of the two attributes specified. Paths whose attributes
 * are all unspecified are left out. Pure.
 */
export function parseCheckAttr(output: string): ReadonlyMap<string, DiffAttributes> {
  const fields = output.split('\0');
  const attributes = new Map<string, DiffAttributes>();
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const path = fields[index] ?? '';
    const name = fields[index + 1];
    const value = fields[index + 2] ?? 'unspecified';
    const parsed = attributeFrom(name, value);
    if (path === '' || parsed === undefined) {
      continue;
    }
    attributes.set(path, { ...attributes.get(path), ...parsed });
  }
  return attributes;
}

function attributeFrom(name: string | undefined, value: string): DiffAttributes | undefined {
  if (value === 'unspecified') {
    return undefined;
  }
  if (name === 'linguist-generated') {
    return { generated: value !== 'unset' && value !== 'false' };
  }
  if (name === 'diff' && value === 'unset') {
    return { diff: false };
  }
  return undefined;
}
