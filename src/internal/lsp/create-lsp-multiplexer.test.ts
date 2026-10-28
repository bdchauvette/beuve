import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Result } from '#pkg/result/result.ts';

import { createLspMultiplexer } from './create-lsp-multiplexer.ts';
import type { LspMultiplexer } from './create-lsp-multiplexer.ts';
import type { LspError } from './lsp-error.ts';
import type { CallHierarchyNode } from './lsp-model.ts';
import type { ServerDefinition } from './server-definition.ts';
import { createTypescriptProject } from './testing/create-typescript-project.ts';
import type { TypescriptProject } from './testing/create-typescript-project.ts';
import { writeFakeLanguageServer } from './testing/write-fake-language-server.ts';
import { typescriptServerDefinition } from './typescript-server-definition.ts';

const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
const binDirectory = path.join(repositoryRoot, 'node_modules', '.bin');
const whitespace = /\s+/u;
const tsserverPath = path.join(repositoryRoot, 'node_modules', 'typescript', 'lib', 'tsserver.js');

describe('createLspMultiplexer with typescript-language-server', { timeout: 60_000 }, () => {
  let project: TypescriptProject;
  let lsp: LspMultiplexer;

  beforeAll(() => {
    project = createTypescriptProject();
    lsp = createLspMultiplexer({
      servers: [typescriptServerDefinition({ tsserverPath })],
      searchDirectories: [binDirectory],
      requestTimeoutMs: 30_000,
      diagnosticsTimeoutMs: 45_000,
    });
  });

  afterAll(async () => {
    await lsp.dispose();
    project.cleanup();
  });

  it('reports the type error in a file once diagnostics settle', async () => {
    const report = unwrap(await lsp.getDiagnostics({ root: project.root, path: 'src/broken.ts' }));
    expect(report).toMatchObject({
      path: 'src/broken.ts',
      serverId: 'typescript',
      freshness: 'fresh',
    });
    expect(report.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'error',
        code: '2322',
        source: 'typescript',
        range: { start: { line: 0, character: 13 }, end: { line: 0, character: 19 } },
      }),
    ]);
  });

  it('reports a clean file as clean, and follows edits on disk', async () => {
    const clean = unwrap(await lsp.getDiagnostics({ root: project.root, path: 'src/a.ts' }));
    expect(clean).toMatchObject({ freshness: 'fresh', diagnostics: [] });

    project.write('src/broken.ts', 'export const answer: number = 42;\n');
    const fixed = unwrap(await lsp.getDiagnostics({ root: project.root, path: 'src/broken.ts' }));
    expect(fixed.diagnostics).toEqual([]);

    project.write('src/c.ts', 'export function c(n: string): number {\n  return n.length;\n}\n');
    const dependent = unwrap(await lsp.getDiagnostics({ root: project.root, path: 'src/a.ts' }));
    expect(dependent.diagnostics).toEqual([]);
    const broken = unwrap(await lsp.getDiagnostics({ root: project.root, path: 'src/b.ts' }));
    expect(broken.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['2345']);

    project.write('src/c.ts', 'export function c(n: number): number {\n  return n * 2;\n}\n');
    const restored = unwrap(await lsp.getDiagnostics({ root: project.root, path: 'src/b.ts' }));
    expect(restored.diagnostics).toEqual([]);
  });

  it('finds the callers of c and expands them lazily', async () => {
    const [c] = unwrap(
      await lsp.prepareCallHierarchy({
        root: project.root,
        path: 'src/c.ts',
        position: { line: 0, character: 16 },
      }),
    );
    expect(c).toMatchObject({
      name: 'c',
      kind: 'function',
      file: { kind: 'workspace', path: 'src/c.ts' },
      selectionRange: { start: { line: 0, character: 16 }, end: { line: 0, character: 17 } },
    });
    const callers = unwrap(await lsp.incomingCalls(requireNode(c).id));
    const names = callers
      .map((call) => call.node.name)
      .toSorted((left, right) => left.localeCompare(right));
    expect(names).toEqual(['b', 'wide']);
    const fromB = callers.find((call) => call.node.name === 'b');
    expect(fromB?.node.file).toEqual({ kind: 'workspace', path: 'src/b.ts' });
    expect(fromB?.callSites).toEqual([
      { start: { line: 3, character: 9 }, end: { line: 3, character: 10 } },
    ]);

    const callersOfB = unwrap(await lsp.incomingCalls(requireNode(fromB?.node).id));
    expect(callersOfB.map((call) => call.node.name)).toEqual(['a']);
  });

  it('follows outgoing calls from a to b and on to c', async () => {
    const [a] = unwrap(
      await lsp.prepareCallHierarchy({
        root: project.root,
        path: 'src/a.ts',
        position: { line: 2, character: 16 },
      }),
    );
    const fromA = unwrap(await lsp.outgoingCalls(requireNode(a).id));
    expect(fromA.map((call) => call.node.name)).toEqual(['b']);
    expect(fromA[0]?.callSites).toEqual([
      { start: { line: 3, character: 9 }, end: { line: 3, character: 10 } },
    ]);
    const fromB = unwrap(await lsp.outgoingCalls(requireNode(fromA[0]?.node).id));
    expect(fromB.map((call) => [call.node.name, call.node.file])).toEqual([
      ['c', { kind: 'workspace', path: 'src/c.ts' }],
    ]);
  });

  it('keeps UTF-16 columns exact after astral characters in a CRLF file', async () => {
    const line = "export const label = '😀😀'; export function wide(): number { return c(3); }";
    const [wide] = unwrap(
      await lsp.prepareCallHierarchy({
        root: project.root,
        path: 'src/wide.ts',
        position: { line: 2, character: line.indexOf('wide') + 1 },
      }),
    );
    expect(wide?.name).toBe('wide');
    expect(wide?.selectionRange).toEqual({
      start: { line: 2, character: line.indexOf('wide') },
      end: { line: 2, character: line.indexOf('wide') + 4 },
    });
    const calls = unwrap(await lsp.outgoingCalls(requireNode(wide).id));
    expect(calls[0]?.callSites).toEqual([
      {
        start: { line: 2, character: line.indexOf('c(3)') },
        end: { line: 2, character: line.indexOf('c(3)') + 1 },
      },
    ]);
  });

  it('answers symbols, hover and definition', async () => {
    const symbols = unwrap(await lsp.documentSymbols({ root: project.root, path: 'src/b.ts' }));
    expect(symbols).toContainEqual(expect.objectContaining({ name: 'b', kind: 'function' }));
    const hover = unwrap(
      await lsp.hover({
        root: project.root,
        path: 'src/b.ts',
        position: { line: 3, character: 9 },
      }),
    );
    expect(hover).toMatchObject({
      kind: 'markdown',
      value: expect.stringContaining('c(n: number): number') as unknown,
    });
    const definition = unwrap(
      await lsp.definition({
        root: project.root,
        path: 'src/b.ts',
        position: { line: 3, character: 9 },
      }),
    );
    expect(definition).toEqual([
      {
        file: { kind: 'workspace', path: 'src/c.ts' },
        range: { start: { line: 0, character: 16 }, end: { line: 0, character: 17 } },
      },
    ]);
  });

  it('refuses paths outside the root, odd files and unknown nodes', async () => {
    const outside = mkdtempSync(path.join(os.tmpdir(), 'beuve-lsp-outside-'));
    try {
      writeFileSync(path.join(outside, 'secret.ts'), 'export const secret = 1;\n');
      symlinkSync(path.join(outside, 'secret.ts'), path.join(project.root, 'src', 'link.ts'));
      const cases = [
        [{ root: project.root, path: '../secret.ts' }, 'path-outside-root'],
        [{ root: project.root, path: path.join(outside, 'secret.ts') }, 'path-outside-root'],
        [{ root: project.root, path: 'src/link.ts' }, 'path-outside-root'],
        [{ root: project.root, path: 'tsconfig.json' }, 'unsupported-language'],
        [{ root: project.root, path: 'src/missing.ts' }, 'invalid-path'],
        [{ root: 'relative/root', path: 'a.ts' }, 'invalid-root'],
      ] as const;
      for (const [request, kind] of cases) {
        expect(await lsp.getDiagnostics(request), request.path).toMatchObject({
          ok: false,
          error: { kind },
        });
      }
      expect(await lsp.incomingCalls('no-such-node')).toEqual({
        ok: false,
        error: { kind: 'unknown-node', nodeId: 'no-such-node' },
      });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('restarts a crashed server on the next call', async () => {
    const [running] = lsp.status();
    expect(running).toMatchObject({ state: 'running', restarts: 0 });
    process.kill(requirePid(running?.pid), 'SIGKILL');
    await waitUntil(() => lsp.status().every((status) => status.state !== 'running'));
    const report = unwrap(await lsp.getDiagnostics({ root: project.root, path: 'src/a.ts' }));
    expect(report.diagnostics).toEqual([]);
    expect(lsp.status()).toMatchObject([{ state: 'running', restarts: 1 }]);
  });

  it('leaves no server or tsserver processes behind after dispose', async () => {
    const pid = requirePid(lsp.status()[0]?.pid);
    const tree = descendantsOf(pid);
    expect(tree.length).toBeGreaterThan(0);
    await lsp.dispose();
    expect(lsp.status()).toEqual([]);
    await waitUntil(() => [pid, ...tree].every((member) => !isAlive(member)));
    await expect(lsp.getDiagnostics({ root: project.root, path: 'src/a.ts' })).resolves.toEqual({
      ok: false,
      error: { kind: 'disposed' },
    });
  });
});

describe('createLspMultiplexer with a scripted server', { timeout: 20_000 }, () => {
  let project: TypescriptProject;
  let script: string;

  beforeAll(() => {
    project = createTypescriptProject();
    script = writeFakeLanguageServer(project.root);
  });

  afterAll(() => {
    project.cleanup();
  });

  const fakeServer = (mode: string): ServerDefinition => ({
    id: 'fake',
    command: process.execPath,
    args: [script, mode],
    languageIds: { '.ts': 'typescript' },
    diagnosticsQuietMs: 20,
  });

  it('converts UTF-16 positions to the negotiated UTF-8 and back', async () => {
    const lsp = createLspMultiplexer({ servers: [fakeServer('normal')] });
    try {
      const line = "export const label = '😀😀'; export function wide(): number { return c(3); }";
      const column = line.indexOf('wide');
      const [node] = unwrap(
        await lsp.prepareCallHierarchy({
          root: project.root,
          path: 'src/wide.ts',
          position: { line: 2, character: column },
        }),
      );
      expect(JSON.parse(node?.detail ?? '')).toEqual({ line: 2, character: column + 4 });
      expect(node?.selectionRange).toEqual({
        start: { line: 2, character: column },
        end: { line: 2, character: column + 4 },
      });
      const report = unwrap(await lsp.getDiagnostics({ root: project.root, path: 'src/a.ts' }));
      expect(report).toMatchObject({
        freshness: 'fresh',
        diagnostics: [{ severity: 'warning', message: 'version 1' }],
      });
    } finally {
      await lsp.dispose();
    }
  });

  it('stops an idle server and starts it again on demand', async () => {
    const lsp = createLspMultiplexer({ servers: [fakeServer('normal')], idleTimeoutMs: 100 });
    try {
      const request = { root: project.root, path: 'src/a.ts' };
      unwrap(await lsp.getDiagnostics(request));
      const pid = requirePid(lsp.status()[0]?.pid);
      await waitUntil(() => lsp.status().length === 0 && !isAlive(pid));
      unwrap(await lsp.getDiagnostics(request));
      expect(lsp.status()).toMatchObject([{ state: 'running', restarts: 0 }]);
    } finally {
      await lsp.dispose();
    }
  });

  it('gives up on a server that keeps failing until the restart window passes', async () => {
    const lsp = createLspMultiplexer({ servers: [fakeServer('fail-initialize')], maxRestarts: 1 });
    try {
      const request = { root: project.root, path: 'src/a.ts' };
      await expect(lsp.getDiagnostics(request)).resolves.toMatchObject({
        error: { kind: 'server-start-failed' },
      });
      await expect(lsp.getDiagnostics(request)).resolves.toMatchObject({
        error: { kind: 'server-start-failed' },
      });
      await expect(lsp.getDiagnostics(request)).resolves.toMatchObject({
        error: { kind: 'server-exited', restartsExhausted: true },
      });
    } finally {
      await lsp.dispose();
    }
  });

  it('does not search the workspace for server binaries unless trusted', async () => {
    const lsp = createLspMultiplexer({
      servers: [{ ...fakeServer('normal'), command: 'planted-server' }],
      environment: { PATH: '' },
    });
    project.write('node_modules/.bin/planted-server', '#!/bin/sh\nexit 1\n');
    try {
      const result = await lsp.getDiagnostics({ root: project.root, path: 'src/a.ts' });
      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'server-not-found', searched: [] },
      });
    } finally {
      await lsp.dispose();
    }
  });
});

function unwrap<T>(result: Result<T, LspError>): T {
  if (!result.ok) {
    throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function requireNode(node: CallHierarchyNode | undefined): CallHierarchyNode {
  if (node === undefined) {
    throw new Error('expected a call hierarchy node');
  }
  return node;
}

function requirePid(pid: number | undefined): number {
  if (pid === undefined) {
    throw new Error('expected a running server');
  }
  return pid;
}

function descendantsOf(pid: number): number[] {
  const table = execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .map((row) => row.trim().split(whitespace).map(Number));
  const found: number[] = [];
  const queue = [pid];
  while (queue.length > 0) {
    const parent = queue.shift();
    for (const [child, childParent] of table) {
      if (child === undefined || childParent !== parent) {
        continue;
      }

      found.push(child);
      queue.push(child);
    }
  }
  return found;
}

/** Running or stopped, but not a zombie awaiting a reaper (containers often lack one). */
function isAlive(pid: number): boolean {
  try {
    const state = execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
    return !state.trimStart().startsWith('Z');
  } catch {
    return false;
  }
}

async function waitUntil(isSatisfied: () => boolean): Promise<void> {
  const deadline = performance.now() + 10_000;
  while (!isSatisfied()) {
    if (performance.now() > deadline) {
      throw new Error('condition not met in time');
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }
}
