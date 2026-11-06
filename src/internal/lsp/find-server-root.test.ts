import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe } from 'vitest';

import { test } from '#testing/test.ts';

import { findServerRoot } from './find-server-root.ts';
import type { WorkspaceRoot } from './resolve-workspace-root.ts';

/** A checkout with two Go-style modules and a directory that belongs to neither. */
function createCheckout(directory: string): WorkspaceRoot {
  const root = realpathSync(directory);
  mkdirSync(path.join(root, 'services/api/handlers'), { recursive: true });
  mkdirSync(path.join(root, 'services/worker'), { recursive: true });
  mkdirSync(path.join(root, 'docs'), { recursive: true });
  writeFileSync(path.join(root, 'services/api/go.mod'), 'module api\n');
  writeFileSync(path.join(root, 'services/worker/go.mod'), 'module worker\n');
  writeFileSync(path.join(root, 'services/api/handlers/h.go'), 'package handlers\n');
  writeFileSync(path.join(root, 'docs/readme.go'), 'package docs\n');
  return root as WorkspaceRoot;
}

describe('findServerRoot', () => {
  test('is the nearest directory with a marker, up from the file', async ({ expect, tempDir }) => {
    const workspace = createCheckout(tempDir);
    const root = await findServerRoot({
      workspace,
      file: path.join(workspace, 'services/api/handlers/h.go'),
      markers: ['go.mod'],
    });
    expect(root).toBe(path.join(workspace, 'services/api'));
  });

  test('gives each module its own root', async ({ expect, tempDir }) => {
    const workspace = createCheckout(tempDir);
    writeFileSync(path.join(workspace, 'services/worker/main.go'), 'package main\n');
    const worker = await findServerRoot({
      workspace,
      file: path.join(workspace, 'services/worker/main.go'),
      markers: ['go.mod'],
    });
    expect(worker).toBe(path.join(workspace, 'services/worker'));
  });

  test('is the checkout when no directory on the way has a marker, or there are no markers', async ({
    expect,
    tempDir,
  }) => {
    const workspace = createCheckout(tempDir);
    const file = path.join(workspace, 'docs/readme.go');
    const inModule = path.join(workspace, 'services/api/handlers/h.go');
    await expect(findServerRoot({ workspace, file, markers: ['go.mod'] })).resolves.toBe(workspace);
    await expect(findServerRoot({ workspace, file: inModule, markers: [] })).resolves.toBe(
      workspace,
    );
  });

  test('takes any of several markers, directories included', async ({ expect, tempDir }) => {
    const workspace = createCheckout(tempDir);
    mkdirSync(path.join(workspace, 'docs/.venv'));
    const root = await findServerRoot({
      workspace,
      file: path.join(workspace, 'docs/readme.go'),
      markers: ['pyproject.toml', '.venv'],
    });
    expect(root).toBe(path.join(workspace, 'docs'));
  });

  test('never looks above the checkout', async ({ expect, tempDir }) => {
    const outer = realpathSync(tempDir);
    writeFileSync(path.join(outer, 'go.mod'), 'module outer\n');
    const workspace = path.join(outer, 'checkout');
    mkdirSync(workspace);
    writeFileSync(path.join(workspace, 'a.go'), 'package a\n');
    const root = await findServerRoot({
      workspace: workspace as WorkspaceRoot,
      file: path.join(workspace, 'a.go'),
      markers: ['go.mod'],
    });
    expect(root).toBe(workspace);
  });
});
