import type { NodeRuntimeError } from './resolve-node-runtime.ts';

/** One sentence for the reviewer or an agent: why language servers and probes can't run. */
export function describeNodeRuntimeError(error: NodeRuntimeError): string {
  switch (error.kind) {
    case 'missing': {
      return error.source === 'bundled'
        ? `beuve's bundled Node is missing (${error.searched.join(', ')}); reinstall beuve.`
        : 'No node on PATH. Unpackaged beuve runs language servers and trace probes with the node on PATH, which must be Node 26 or later (.node-version).';
    }
    case 'unrunnable': {
      return `${error.command} could not report its version: ${error.reason}`;
    }
    case 'too-old': {
      return `Language servers and trace probes need Node ${String(error.minimumMajor)} or later; found ${error.version} at ${error.command}.`;
    }
  }
}
