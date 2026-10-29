/** A registry key name as this platform writes it: `⌘⇧P` stays on macOS, else `Ctrl+Shift+P`. Pure. */
export function displayKey(key: string, platform: string | undefined): string {
  return platform === 'darwin' || !key.includes('⌘')
    ? key
    : key.replace('⌘', 'Ctrl+').replace('⇧', 'Shift+');
}
