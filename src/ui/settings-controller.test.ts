import { describe } from 'vitest';

import { createDiffDisplay } from './testing/create-diff-display.ts';
import { createSettingsHarness } from './testing/create-settings-harness.ts';
import { test } from './testing/test.ts';

interface OkReply {
  readonly ok: true;
  readonly value: unknown;
}

interface FailedReply {
  readonly ok: false;
  readonly error: { readonly code: string; readonly message: string };
}

function ok(value: unknown): OkReply {
  return { ok: true, value };
}

function failed(message: string): FailedReply {
  return { ok: false, error: { code: 'invalid-request', message } };
}

describe('SettingsController', () => {
  test('starts with the default display and no editor', ({ expect }) => {
    const { settings } = createSettingsHarness();
    expect(settings.display).toStrictEqual(createDiffDisplay());
    expect(settings.editorSettings).toBeUndefined();
  });

  test('reads the editor and the display at start and reports the display', async ({ expect }) => {
    const loaded = createDiffDisplay({ layout: 'unified' });
    const { settings, applied, invoked } = createSettingsHarness({
      replies: {
        'editor:get-settings': ok({ preferred: 'zed' }),
        'display:get': ok(loaded),
      },
    });
    await settings.load();
    expect(invoked.map(([channel]) => channel)).toStrictEqual([
      'editor:get-settings',
      'display:get',
    ]);
    expect(settings.editorSettings).toStrictEqual({ preferred: 'zed' });
    expect(settings.display).toStrictEqual(loaded);
    expect(applied).toStrictEqual([{ previous: createDiffDisplay(), next: loaded }]);
  });

  test('keeps the defaults when main cannot answer at start', async ({ expect }) => {
    const { settings, applied } = createSettingsHarness({
      replies: { 'editor:get-settings': failed('no'), 'display:get': failed('no') },
    });
    await settings.load();
    expect(settings.display).toStrictEqual(createDiffDisplay());
    expect(settings.editorSettings).toBeUndefined();
    expect(applied).toStrictEqual([]);
  });

  test('reads both again when the Settings window changes them', async ({ expect }) => {
    const changed = createDiffDisplay({ ignoreWhitespace: true });
    const { settings, emit, applied } = createSettingsHarness({
      replies: { 'editor:get-settings': ok({ preferred: 'cursor' }), 'display:get': ok(changed) },
    });
    settings.hostConnected();
    emit('settings:changed', {});
    await expect.poll(() => settings.editorSettings).toStrictEqual({ preferred: 'cursor' });
    expect(settings.display).toStrictEqual(changed);
    expect(applied).toHaveLength(1);
  });

  test('stops listening when the host disconnects', ({ expect }) => {
    const { settings, listening } = createSettingsHarness();
    settings.hostConnected();
    expect(listening()).toBe(1);
    settings.hostDisconnected();
    expect(listening()).toBe(0);
  });

  test('stores a display change and reports before and after', async ({ expect }) => {
    const next = createDiffDisplay({ layout: 'unified' });
    const { settings, applied, invoked } = createSettingsHarness({
      replies: { 'display:set': ok(next) },
    });
    const stored = await settings.change({ layout: 'unified' });
    expect(stored).toStrictEqual(next);
    expect(invoked).toStrictEqual([['display:set', { layout: 'unified' }]]);
    expect(applied).toStrictEqual([{ previous: createDiffDisplay(), next }]);
  });

  test('only reads the display for an empty change', async ({ expect }) => {
    const { settings, invoked } = createSettingsHarness({
      replies: { 'display:get': ok(createDiffDisplay()) },
    });
    await settings.change({});
    expect(invoked).toStrictEqual([['display:get', undefined]]);
  });

  test('says why a display change failed and keeps the display', async ({ expect }) => {
    const { settings, notices, applied } = createSettingsHarness({
      replies: { 'display:set': failed('read-only') },
    });
    const stored = await settings.change({ layout: 'unified' });
    expect(stored).toBeUndefined();
    expect(notices).toStrictEqual([{ tone: 'error', text: 'read-only' }]);
    expect(settings.display).toStrictEqual(createDiffDisplay());
    expect(applied).toStrictEqual([]);
  });

  test('changes nothing without a bridge', async ({ expect }) => {
    const { settings, invoked } = createSettingsHarness({ hasBridge: false });
    await expect(settings.change({ layout: 'unified' })).resolves.toBeUndefined();
    await expect(settings.chooseEditor('zed')).resolves.toBeUndefined();
    expect(invoked).toStrictEqual([]);
  });

  test('reads the editor without an id and stores one with an id', async ({ expect }) => {
    const { settings, invoked } = createSettingsHarness({
      replies: {
        'editor:get-settings': ok({ preferred: 'zed' }),
        'editor:set-preferred': ok({ preferred: 'vscode' }),
      },
    });
    await settings.chooseEditor();
    expect(settings.editorSettings).toStrictEqual({ preferred: 'zed' });
    await settings.chooseEditor('vscode');
    expect(settings.editorSettings).toStrictEqual({ preferred: 'vscode' });
    expect(invoked).toStrictEqual([
      ['editor:get-settings', undefined],
      ['editor:set-preferred', { editorId: 'vscode' }],
    ]);
  });

  test('returns a refused editor choice and keeps the editor', async ({ expect }) => {
    const { settings } = createSettingsHarness({
      replies: { 'editor:set-preferred': failed('not installed') },
    });
    const result = await settings.chooseEditor('zed');
    expect(result).toStrictEqual(failed('not installed'));
    expect(settings.editorSettings).toBeUndefined();
  });
});
