import { describe, expect, it } from 'vitest';

import { describeEditorSettings } from './describe-editor-settings.ts';

describe('describeEditorSettings', () => {
  it('says what is preferred and what is found', () => {
    const lines = describeEditorSettings({
      preferred: 'cursor',
      editors: [
        { id: 'zed', name: 'Zed', installed: true },
        { id: 'cursor', name: 'Cursor', installed: false },
      ],
    });
    expect(lines[0]).toContain('Cursor (not found');
    expect(lines[1]).toBe('Found: Zed.');
  });

  it('handles no choice and nothing installed', () => {
    const lines = describeEditorSettings({ editors: [] });
    expect(lines[0]).toContain('No editor chosen');
    expect(lines[1]).toBe('No supported editor found.');
  });
});
