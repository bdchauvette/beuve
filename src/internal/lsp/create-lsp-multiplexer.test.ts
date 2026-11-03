import { execFile } from 'node:child_process';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import process from 'node:process';

import { describe } from 'vitest';

import { okValueFrom } from '#testing/ok-value-from.ts';

import type { Result } from '#x/result/result.ts';

import { createLspMultiplexer } from './create-lsp-multiplexer.ts';
import type { PositionRequest } from './create-lsp-multiplexer.ts';
import type { LspError } from './lsp-error.ts';
import type { CallHierarchyNode } from './lsp-model.ts';
import type { ServerDefinition } from './server-definition.ts';
import { pollUntil } from './testing/poll-until.ts';
import { test } from './testing/test.ts';
import type { FakeServerMode } from './testing/write-fake-language-server.ts';

describe('createLspMultiplexer with typescript-language-server', { timeout: 60_000 }, () => {
  test('follows edits on disk', async ({ expect, typescriptWorkspace: { project, lsp } }) => {
    const request = { root: project.root, path: 'src/b.ts' };
    const before = okValueFrom(await lsp.documentSymbols(request));
    expect(before.map((symbol) => symbol.name)).not.toContain('renamed');

    project.write({ 'src/b.ts': 'export function renamed(n: number): number {\n  return n;\n}\n' });
    const after = okValueFrom(await lsp.documentSymbols(request));
    expect(after.map((symbol) => symbol.name)).toStrictEqual(['renamed']);
  });

  test('finds the callers of c and expands them lazily', async ({
    expect,
    sharedTypescriptWorkspace: { project, lsp },
  }) => {
    const [c] = okValueFrom(
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
    const callers = okValueFrom(await lsp.incomingCalls(requireNode(c).id));
    const names = callers
      .map((call) => call.node.name)
      .toSorted((left, right) => left.localeCompare(right));
    expect(names).toStrictEqual(['b', 'wide']);
    const fromB = callers.find((call) => call.node.name === 'b');
    expect(fromB?.node.file).toStrictEqual({ kind: 'workspace', path: 'src/b.ts' });
    expect(fromB?.callSites).toStrictEqual([
      { start: { line: 3, character: 9 }, end: { line: 3, character: 10 } },
    ]);

    const callersOfB = okValueFrom(await lsp.incomingCalls(requireNode(fromB?.node).id));
    expect(callersOfB.map((call) => call.node.name)).toStrictEqual(['a']);
  });

  test('follows outgoing calls from a to b and on to c', async ({
    expect,
    sharedTypescriptWorkspace: { project, lsp },
  }) => {
    const [a] = okValueFrom(
      await lsp.prepareCallHierarchy({
        root: project.root,
        path: 'src/a.ts',
        position: { line: 2, character: 16 },
      }),
    );
    const fromA = okValueFrom(await lsp.outgoingCalls(requireNode(a).id));
    expect(fromA.map((call) => call.node.name)).toStrictEqual(['b']);
    expect(fromA[0]?.callSites).toStrictEqual([
      { start: { line: 3, character: 9 }, end: { line: 3, character: 10 } },
    ]);
    const fromB = okValueFrom(await lsp.outgoingCalls(requireNode(fromA[0]?.node).id));
    expect(
      fromB.map((call) => {
        return [call.node.name, call.node.file];
      }),
    ).toStrictEqual([['c', { kind: 'workspace', path: 'src/c.ts' }]]);
  });

  test('keeps UTF-16 columns exact after astral characters in a CRLF file', async ({
    expect,
    sharedTypescriptWorkspace: { project, lsp },
  }) => {
    const line = "export const label = '😀😀'; export function wide(): number { return c(3); }";
    const [wide] = okValueFrom(
      await lsp.prepareCallHierarchy({
        root: project.root,
        path: 'src/wide.ts',
        position: { line: 2, character: line.indexOf('wide') + 1 },
      }),
    );
    expect(wide?.name).toBe('wide');
    expect(wide?.selectionRange).toStrictEqual({
      start: { line: 2, character: line.indexOf('wide') },
      end: { line: 2, character: line.indexOf('wide') + 4 },
    });
    const calls = okValueFrom(await lsp.outgoingCalls(requireNode(wide).id));
    expect(calls[0]?.callSites).toStrictEqual([
      {
        start: { line: 2, character: line.indexOf('c(3)') },
        end: { line: 2, character: line.indexOf('c(3)') + 1 },
      },
    ]);
  });

  test('answers document symbols', async ({
    expect,
    sharedTypescriptWorkspace: { project, lsp },
  }) => {
    const symbols = okValueFrom(
      await lsp.documentSymbols({ root: project.root, path: 'src/b.ts' }),
    );
    expect(symbols).toContainEqual(expect.objectContaining({ name: 'b', kind: 'function' }));
  });

  test('finds where a called function and a type are defined, across files', async ({
    expect,
    sharedTypescriptWorkspace: { project, lsp },
  }) => {
    const [definition, typeDefinition, nothingThere] = await Promise.all([
      lsp.definition({
        root: project.root,
        path: 'src/b.ts',
        position: { line: 3, character: 9 },
      }),
      lsp.definition({
        root: project.root,
        path: 'src/shape.ts',
        position: { line: 3, character: 13 },
        kind: 'type-definition',
      }),
      lsp.definition({
        root: project.root,
        path: 'src/b.ts',
        position: { line: 1, character: 0 },
      }),
    ]);
    expect(okValueFrom(definition)).toStrictEqual([
      {
        file: { kind: 'workspace', path: 'src/c.ts' },
        range: { start: { line: 0, character: 16 }, end: { line: 0, character: 17 } },
      },
    ]);
    expect(okValueFrom(typeDefinition)).toStrictEqual([
      {
        file: { kind: 'workspace', path: 'src/shape.ts' },
        range: { start: { line: 0, character: 17 }, end: { line: 0, character: 22 } },
      },
    ]);
    expect(okValueFrom(nothingThere)).toStrictEqual([]);
  });

  test('hovers over a symbol, with the token range, and has nothing for blank space', async ({
    expect,
    sharedTypescriptWorkspace: { project, lsp },
  }) => {
    const [called, blank] = await Promise.all([
      lsp.hover({ root: project.root, path: 'src/b.ts', position: { line: 3, character: 9 } }),
      lsp.hover({ root: project.root, path: 'src/b.ts', position: { line: 1, character: 0 } }),
    ]);
    const hover = okValueFrom(called);
    expect(hover?.markdown).toContain('c(n: number): number');
    expect(hover?.range).toStrictEqual({
      start: { line: 3, character: 9 },
      end: { line: 3, character: 10 },
    });
    expect(okValueFrom(blank)).toBeUndefined();
  });

  test('refuses paths outside the root, odd files and unknown nodes', async ({
    expect,
    tempDir,
    typescriptWorkspace: { project, lsp },
  }) => {
    const outside = path.join(tempDir, 'outside');
    mkdirSync(outside);
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
    const kinds = await Promise.all(
      cases.map(async ([request]) => {
        return errorKindOf(await lsp.documentSymbols(request));
      }),
    );
    expect(kinds).toStrictEqual(cases.map(([, kind]) => kind));
    await expect(lsp.incomingCalls('no-such-node')).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'unknown-node', nodeId: 'no-such-node' },
    });
  });

  test('restarts a crashed server on the next call', async ({
    expect,
    typescriptWorkspace: { project, lsp },
  }) => {
    const request = { root: project.root, path: 'src/a.ts' };
    okValueFrom(await lsp.documentSymbols(request));
    const [running] = lsp.status();
    expect(running).toMatchObject({ state: 'running', restarts: 0 });
    process.kill(requirePid(running?.pid), 'SIGKILL');
    await waitUntil('the crashed server to be noticed', () => {
      return lsp.status().every((status) => status.state !== 'running');
    });
    const symbols = okValueFrom(await lsp.documentSymbols(request));
    expect(symbols).toContainEqual(expect.objectContaining({ name: 'a', kind: 'function' }));
    expect(lsp.status()).toMatchObject([{ state: 'running', restarts: 1 }]);
  });

  test('leaves no server or tsserver processes behind after dispose', async ({
    expect,
    typescriptWorkspace: { project, lsp },
  }) => {
    okValueFrom(await lsp.documentSymbols({ root: project.root, path: 'src/a.ts' }));
    const pid = requirePid(lsp.status()[0]?.pid);
    const tree = await descendantsOf(pid);
    expect(tree.length).toBeGreaterThan(0);
    await lsp.dispose();
    expect(lsp.status()).toStrictEqual([]);
    await waitUntil('the server processes to exit', async () => {
      const alive = await Promise.all([pid, ...tree].map(async (member) => isAlive(member)));
      return alive.every((member) => !member);
    });
    await expect(
      lsp.documentSymbols({ root: project.root, path: 'src/a.ts' }),
    ).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'disposed' },
    });
  });
});

describe('createLspMultiplexer with a scripted server', { timeout: 20_000 }, () => {
  test('converts UTF-16 positions to the negotiated UTF-8 and back', async ({
    expect,
    closing,
    typescriptProject: project,
    fakeServerScript,
  }) => {
    const lsp = createLspMultiplexer({ servers: [fakeServer(fakeServerScript, 'normal')] });
    closing(lsp);
    const line = "export const label = '😀😀'; export function wide(): number { return c(3); }";
    const column = line.indexOf('wide');
    const [node] = okValueFrom(
      await lsp.prepareCallHierarchy({
        root: project.root,
        path: 'src/wide.ts',
        position: { line: 2, character: column },
      }),
    );
    expect(JSON.parse(node?.detail ?? '')).toStrictEqual({ line: 2, character: column + 4 });
    expect(node?.selectionRange).toStrictEqual({
      start: { line: 2, character: column },
      end: { line: 2, character: column + 4 },
    });
  });

  test('stops an idle server and starts it again on demand', async ({
    expect,
    closing,
    typescriptProject: project,
    fakeServerScript,
  }) => {
    const lsp = createLspMultiplexer({
      servers: [fakeServer(fakeServerScript, 'normal')],
      idleTimeout: Temporal.Duration.from({ milliseconds: 100 }),
    });
    closing(lsp);
    const request = scriptedRequest(project.root);
    okValueFrom(await lsp.prepareCallHierarchy(request));
    const pid = requirePid(lsp.status()[0]?.pid);
    await waitUntil('the idle server to stop', async () => {
      return lsp.status().length === 0 && !(await isAlive(pid));
    });
    okValueFrom(await lsp.prepareCallHierarchy(request));
    expect(lsp.status()).toMatchObject([{ state: 'running', restarts: 0 }]);
  });

  test('gives up on a server that keeps failing until the restart window passes', async ({
    expect,
    closing,
    typescriptProject: project,
    fakeServerScript,
  }) => {
    const lsp = createLspMultiplexer({
      servers: [fakeServer(fakeServerScript, 'fail-initialize')],
      maxRestarts: 1,
    });
    closing(lsp);
    const request = scriptedRequest(project.root);
    await expect(lsp.prepareCallHierarchy(request)).resolves.toMatchObject({
      error: { kind: 'server-start-failed' },
    });
    await expect(lsp.prepareCallHierarchy(request)).resolves.toMatchObject({
      error: { kind: 'server-start-failed' },
    });
    await expect(lsp.prepareCallHierarchy(request)).resolves.toMatchObject({
      error: { kind: 'server-exited', restartsExhausted: true },
    });
  });

  test('does not search the workspace for server binaries unless trusted', async ({
    expect,
    closing,
    typescriptProject: project,
    fakeServerScript,
  }) => {
    const lsp = createLspMultiplexer({
      servers: [{ ...fakeServer(fakeServerScript, 'normal'), command: 'planted-server' }],
      environment: { PATH: '' },
    });
    project.write({ 'node_modules/.bin/planted-server': '#!/bin/sh\nexit 1\n' });
    closing(lsp);
    const result = await lsp.prepareCallHierarchy(scriptedRequest(project.root));
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'server-not-found', searched: [] },
    });
  });
});

function fakeServer(script: string, mode: FakeServerMode): ServerDefinition {
  return {
    id: 'fake',
    command: process.execPath,
    args: [script, mode],
    languageIds: { '.ts': 'typescript' },
  };
}

function scriptedRequest(root: string): PositionRequest {
  return { root, path: 'src/a.ts', position: { line: 0, character: 0 } };
}

function errorKindOf(result: Result<unknown, LspError>): string {
  if (result.ok) {
    return 'ok';
  }
  return result.error.kind;
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

async function descendantsOf(pid: number): Promise<number[]> {
  const { stdout } = await promisify(execFile)('ps', ['-A', '-o', 'pid=,ppid='], {
    encoding: 'utf8',
  });
  const table = stdout
    .trim()
    .split('\n')
    .map((row) => row.trim().split(/\s+/u).map(Number));
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
async function isAlive(pid: number): Promise<boolean> {
  try {
    const { stdout } = await promisify(execFile)('ps', ['-o', 'stat=', '-p', String(pid)], {
      encoding: 'utf8',
    });
    return !stdout.trimStart().startsWith('Z');
  } catch {
    return false;
  }
}

async function waitUntil(
  description: string,
  isSatisfied: () => boolean | Promise<boolean>,
): Promise<void> {
  await pollUntil(description, async () => {
    if (await isSatisfied()) {
      return true;
    }
    return;
  });
}
