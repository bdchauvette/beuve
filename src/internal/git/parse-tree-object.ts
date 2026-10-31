/** One entry of a raw tree object. */
export interface TreeObjectEntry {
  /** Zero-padded to six digits, as `ls-tree` prints it: `100644`, `100755`, `120000`, `040000`, `160000`. */
  readonly mode: string;
  /** One path segment, exactly as stored. */
  readonly name: string;
  readonly objectId: string;
}

const space = 0x20;
const octalMode = /^[0-7]{5,6}$/u;

/**
 * The entries of a raw tree object (`cat-file contents` of a tree): repeated
 * `<octal mode> SP <name> NUL <hash>`, where the hash is `hashBytes` raw bytes (20 for SHA-1,
 * 32 for SHA-256). `undefined` when the bytes are not such a tree.
 */
export function parseTreeObject(
  bytes: Uint8Array,
  hashBytes: number,
): readonly TreeObjectEntry[] | undefined {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: TreeObjectEntry[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const modeEnd = buffer.indexOf(space, offset);
    const nameEnd = modeEnd === -1 ? -1 : buffer.indexOf(0, modeEnd + 1);
    if (nameEnd === -1 || nameEnd + 1 + hashBytes > buffer.length) {
      return undefined;
    }
    const mode = buffer.toString('latin1', offset, modeEnd);
    if (!octalMode.test(mode)) {
      return undefined;
    }
    entries.push({
      mode: mode.padStart(6, '0'),
      name: buffer.toString('utf8', modeEnd + 1, nameEnd),
      objectId: buffer.toString('hex', nameEnd + 1, nameEnd + 1 + hashBytes),
    });
    offset = nameEnd + 1 + hashBytes;
  }
  return entries;
}
