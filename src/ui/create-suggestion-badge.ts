const namespace = 'http://www.w3.org/2000/svg';

/** What the badge says to assistive technology and in its tooltip. */
const label = 'Has suggested changes';

/**
 * The mark of a note that carries a suggestion: a ± glyph (a plus over a minus, as diffs are
 * marked) in the text color, built node by node (no HTML strings, ADR 0077). It is an image named
 * "Has suggested changes", which its tooltip repeats.
 */
export function createSuggestionBadge(): HTMLSpanElement {
  const badge = document.createElement('span');
  badge.className = 'suggestion';
  badge.setAttribute('role', 'img');
  badge.setAttribute('aria-label', label);
  badge.title = label;
  const icon = document.createElementNS(namespace, 'svg');
  icon.setAttribute('viewBox', '0 0 16 16');
  icon.setAttribute('width', '12');
  icon.setAttribute('height', '12');
  icon.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(namespace, 'path');
  path.setAttribute('d', 'M8 2.5v6M5 5.5h6M5 12.5h6');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.5');
  path.setAttribute('stroke-linecap', 'round');
  icon.append(path);
  badge.append(icon);
  return badge;
}
