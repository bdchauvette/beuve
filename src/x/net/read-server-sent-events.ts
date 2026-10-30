const lineBreak = /\r\n|\r|\n/u;
const leadingSpace = /^ /u;

/**
 * The `data` of each event of a `text/event-stream` body (the WHATWG server-sent events format),
 * in order: lines are split on CR, LF or CRLF, an event ends at a blank line, its `data:` lines
 * are joined with newlines, comments and other fields are skipped, and an event without data is
 * not yielded. A final event without its blank line is still yielded. Throws `RangeError` once
 * more than `maxBytes` have been read, so a runaway stream can't fill memory.
 */
export async function* readServerSentEvents(
  body: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  maxBytes: number,
): AsyncGenerator<string, void, undefined> {
  const decoder = new TextDecoder('utf-8');
  let bytes = 0;
  let pending = '';
  let data: string[] = [];
  const take = (line: string): string | undefined => {
    if (line === '') {
      const event = data.length === 0 ? undefined : data.join('\n');
      data = [];
      return event;
    }
    if (line.startsWith(':')) {
      return undefined;
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(leadingSpace, '');
    if (field === 'data') {
      data.push(value);
    }
    return undefined;
  };
  for await (const chunk of body) {
    bytes += chunk.byteLength;
    if (bytes > maxBytes) {
      throw new RangeError(`the event stream is larger than ${String(maxBytes)} bytes`);
    }
    const lines = (pending + decoder.decode(chunk, { stream: true })).split(lineBreak);
    pending = lines.pop() ?? '';
    for (const line of lines) {
      const event = take(line);
      if (event !== undefined) {
        yield event;
      }
    }
  }
  const rest = pending + decoder.decode();
  for (const line of [...rest.split(lineBreak), '']) {
    const event = take(line);
    if (event !== undefined) {
      yield event;
    }
  }
}
