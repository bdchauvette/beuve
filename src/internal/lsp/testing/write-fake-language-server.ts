import { writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Writes a scripted language server (plain JavaScript, run with `process.execPath`) into
 * `directory` and returns its path. Behavior, chosen by its first argument:
 * - `normal`: negotiates UTF-8 positions, asks the client to apply an edit and for configuration
 *   after `initialized`, publishes diagnostics on open/change, echoes `prepareCallHierarchy` and
 *   answers `test/clientAnswers` with what the client replied.
 * - `bare`: like `normal`, but announces no call hierarchy support.
 * - `fail-initialize`: writes to stderr and exits with code 3 on `initialize`.
 */
export function writeFakeLanguageServer(directory: string): string {
  const file = path.join(directory, 'fake-language-server.mjs');
  writeFileSync(file, source);
  return file;
}

/** How the fake server behaves: normally, without call hierarchy, or by failing `initialize`. */
export type FakeServerMode = 'normal' | 'bare' | 'fail-initialize';

const source = String.raw`
const mode = process.argv[2] ?? 'normal';
let buffer = Buffer.alloc(0);
const answers = {};
const send = (message) => {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }), 'utf8');
  process.stdout.write('Content-Length: ' + body.length + '\r\n\r\n');
  process.stdout.write(body);
};
const handle = (message) => {
  if (message.method === undefined) {
    answers[message.id] = message.error ?? message.result;
    return;
  }
  switch (message.method) {
    case 'initialize':
      if (mode === 'fail-initialize') {
        process.stderr.write('fake server refuses to start\n');
        process.exit(3);
      }
      send({ id: message.id, result: { capabilities: {
        positionEncoding: 'utf-8', textDocumentSync: 1, callHierarchyProvider: mode !== 'bare',
      } } });
      return;
    case 'initialized':
      send({ id: 'edit', method: 'workspace/applyEdit', params: { edit: { changes: {} } } });
      send({ id: 'config', method: 'workspace/configuration', params: { items: [{ section: 'fake.flag' }, { section: 'missing' }] } });
      send({ id: 'unknown', method: 'fake/unknownRequest', params: {} });
      return;
    case 'textDocument/didOpen':
    case 'textDocument/didChange': {
      const uri = message.params.textDocument.uri;
      const version = message.params.textDocument.version;
      send({ method: 'textDocument/publishDiagnostics', params: { uri, version, diagnostics: [{
        range: { start: { line: 0, character: 10 }, end: { line: 0, character: 14 } },
        severity: 2, message: 'version ' + version,
      }] } });
      return;
    }
    case 'textDocument/prepareCallHierarchy': {
      const { position, textDocument } = message.params;
      const range = { start: position, end: { line: position.line, character: position.character + 4 } };
      send({ id: message.id, result: [{
        name: 'echo', kind: 12, detail: JSON.stringify(position), uri: textDocument.uri, range, selectionRange: range,
      }] });
      return;
    }
    case 'test/clientAnswers':
      send({ id: message.id, result: answers });
      return;
    case 'shutdown':
      send({ id: message.id, result: null });
      return;
    case 'exit':
      process.exit(0);
    default:
      if (message.id !== undefined) {
        send({ id: message.id, error: { code: -32601, message: 'unhandled ' + message.method } });
      }
  }
};
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const end = buffer.indexOf('\r\n\r\n');
    if (end === -1) return;
    const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, end).toString())[1]);
    if (buffer.length < end + 4 + length) return;
    const body = buffer.subarray(end + 4, end + 4 + length).toString('utf8');
    buffer = buffer.subarray(end + 4 + length);
    handle(JSON.parse(body));
  }
});
`;
