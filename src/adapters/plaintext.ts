/**
 * Reads text the user typed. Unlike domToMarkdown, whitespace is kept exactly as written
 * (pasted code, indentation, line breaks). Block elements are separated by a blank line.
 */
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const SKIP = new Set(['BUTTON', 'SCRIPT', 'STYLE', 'SVG', 'NOSCRIPT', 'TEXTAREA', 'INPUT']);
const BLOCK = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'PRE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE', 'TR']);

export function domToPlainText(root: Node): string {
  return render(root).replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
}

function render(node: Node): string {
  if (node.nodeType === TEXT_NODE) return node.textContent ?? '';
  if (node.nodeType !== ELEMENT_NODE) return '';
  const el = node as Element;
  const tag = el.tagName.toUpperCase();
  if (SKIP.has(tag) || el.classList.contains('sr-only')) return '';
  if (tag === 'BR') return '\n';
  let inner = '';
  el.childNodes.forEach((c) => {
    inner += render(c);
  });
  return BLOCK.has(tag) ? `\n\n${inner}\n\n` : inner;
}
