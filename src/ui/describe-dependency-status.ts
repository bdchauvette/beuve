import type { DependencyStatusView, DependencyToolView } from '#contract/ipc-contract.ts';
import { revealFormatControls } from '#x/text/reveal-format-controls.ts';

/** What the reviewer can do from the dependency status line (ADR 0089, 0090). */
export type DependencyAction =
  'trust' | 'install' | 'reinstall' | 'skip' | 'cancel' | 'view-log' | 'review-files';

/** One button of the status line. */
export interface DependencyButton {
  readonly action: DependencyAction;
  readonly label: string;
}

/** The status line: a quiet text, its tone and hover, and its buttons. */
export interface DependencyLine {
  readonly text: string;
  readonly tone: 'muted' | 'busy' | 'ok' | 'warn' | 'danger';
  readonly title: string;
  readonly buttons: readonly DependencyButton[];
}

/**
 * The status bar's dependency line for the open session (ADR 0089): installing, installed,
 * failed with its reason and the log, not installed with the trust it needs, or the safeguard's
 * question with Review Files, Install and Skip. Repository text is revealed (ADR 0082).
 */
export function describeDependencyStatus(status: DependencyStatusView): DependencyLine {
  const tools = toolsText(status.tools);
  const log: DependencyButton[] = [];
  if (status.hasLog) {
    log.push({ action: 'view-log', label: 'View Log' });
  }
  switch (status.state) {
    case 'untrusted': {
      return {
        text: 'Dependencies: not installed: trust this repository to install',
        tone: 'muted',
        title: 'beuve installs dependencies only for repositories you trust.',
        buttons: [{ action: 'trust', label: 'Trust…' }],
      };
    }
    case 'nothing': {
      return {
        text: 'Dependencies: nothing to install',
        tone: 'muted',
        title: status.detail ?? 'No lockfile, .beuve step or hook at this head.',
        buttons: log,
      };
    }
    case 'needs-approval': {
      return {
        text: 'Dependencies: safeguard: this change modifies dependencies',
        tone: 'warn',
        title: `Changed: ${status.inputs.map((input) => revealFormatControls(input)).join(', ')}`,
        buttons: [
          { action: 'review-files', label: 'Review Files' },
          { action: 'install', label: 'Install' },
          { action: 'skip', label: 'Skip' },
        ],
      };
    }
    case 'declined': {
      return {
        text: 'Dependencies: not installed: skipped at the safeguard',
        tone: 'muted',
        title: `You chose Skip for this head. Changed: ${status.inputs.join(', ')}`,
        buttons: [{ action: 'install', label: 'Install' }, ...log],
      };
    }
    case 'not-installed': {
      return {
        text: 'Dependencies: not installed',
        tone: 'muted',
        title: 'No install has run for this checkout.',
        buttons: [{ action: 'install', label: 'Install' }, ...log],
      };
    }
    case 'pending': {
      return {
        text: `Dependencies: waiting to install${tools}…`,
        tone: 'busy',
        title: 'Waiting for another install of this repository to finish.',
        buttons: [{ action: 'cancel', label: 'Cancel' }],
      };
    }
    case 'running': {
      return {
        text: `Dependencies: installing${tools}…`,
        tone: 'busy',
        title: revealFormatControls(status.detail ?? ''),
        buttons: [{ action: 'cancel', label: 'Cancel' }, ...log],
      };
    }
    case 'done': {
      return {
        text: 'Dependencies: installed',
        tone: 'ok',
        title: `Installed with ${versionsText(status.tools)}.`,
        buttons: [...log, { action: 'reinstall', label: 'Reinstall' }],
      };
    }
    case 'failed': {
      return {
        text: `Dependencies: failed: ${revealFormatControls(status.detail ?? 'see the log')}`,
        tone: 'danger',
        title: revealFormatControls(status.detail ?? ''),
        buttons: [...log, { action: 'install', label: 'Retry' }],
      };
    }
  }
}

function toolsText(tools: readonly DependencyToolView[]): string {
  if (tools.length === 0) {
    return '';
  }
  return ` (${tools.map((tool) => tool.tool).join(', ')})`;
}

function versionsText(tools: readonly DependencyToolView[]): string {
  if (tools.length === 0) {
    return 'the configured steps';
  }
  return tools
    .map((tool) => {
      if (tool.version === undefined) {
        return tool.tool;
      }
      return `${tool.tool} ${tool.version}`;
    })
    .join(', ');
}
