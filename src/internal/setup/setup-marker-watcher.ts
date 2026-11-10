import { tailOf } from '#x/text/tail-of.ts';

/**
 * Watches a terminal's output for a setup run's marker (ADR 0130), which may arrive split across
 * chunks. Keeps only the last few characters between chunks.
 */
export class SetupMarkerWatcher {
  private readonly marker: string;
  private tail = '';
  private isSeen = false;

  constructor(marker: string) {
    this.marker = marker;
  }

  /** Whether this chunk completes the marker; `false` again for every chunk after that. */
  write(chunk: string): boolean {
    if (this.isSeen) {
      return false;
    }
    const text = this.tail + chunk;
    if (text.includes(this.marker)) {
      this.isSeen = true;
      this.tail = '';
      return true;
    }
    this.tail = tailOf(text, this.marker.length - 1);
    return false;
  }
}
