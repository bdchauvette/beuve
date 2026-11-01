// xterm's stylesheet imported as text (`with { type: 'text' }`), which esbuild bundles into the
// renderer for the terminal panel's shadow root (ADR 0095). Only the renderer's project includes it.
declare module '@xterm/xterm/css/xterm.css' {
  const css: string;
  export default css;
}
