const namespace = 'http://www.w3.org/2000/svg';

/**
 * The review-note icon: the chat button's speech bubble, outlined and with two lines of text
 * inside, so a note reads as the chat bubble's sibling. Built node by node (no HTML strings,
 * ADR 0077) and decorative: the label beside it carries the meaning.
 */
export function createUraNoteIcon(size = 12): SVGSVGElement {
  const icon = document.createElementNS(namespace, 'svg');
  icon.setAttribute('viewBox', '0 0 16 16');
  icon.setAttribute('width', String(size));
  icon.setAttribute('height', String(size));
  icon.setAttribute('aria-hidden', 'true');
  icon.classList.add('ura-note-icon');
  icon.append(
    pathOf(
      'M3 2.5h10A1.5 1.5 0 0 1 14.5 4v6a1.5 1.5 0 0 1-1.5 1.5H7.5L4.5 14v-2.5H3A1.5 1.5 0 0 1 1.5 10V4A1.5 1.5 0 0 1 3 2.5Z',
    ),
    pathOf('M4.5 5.5h7M4.5 8h4.5'),
  );
  return icon;
}

function pathOf(d: string): SVGPathElement {
  const path = document.createElementNS(namespace, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  return path;
}
