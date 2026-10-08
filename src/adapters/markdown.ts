/**
 * Converts rendered chat HTML back into Markdown, so code, lists, tables and math
 * survive the trip to another AI. Provider-neutral: adapters pass in the element that
 * holds the message body.
 *
 * Code blocks are swapped for placeholders while the rest is tidied, then restored
 * untouched, so blank lines and indentation inside code are never altered.
 */
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const OPEN = '\uE000';
const CLOSE = '\uE001';

const SKIP_TAGS = new Set(['BUTTON', 'SCRIPT', 'STYLE', 'SVG', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'TEMPLATE']);
const BLOCK_TAGS = new Set([
  'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'FIGURE', 'FIGCAPTION', 'DETAILS', 'SUMMARY', 'DL', 'DT', 'DD',
]);

interface Ctx {
  blocks: string[];
}

export function domToMarkdown(root: Node): string {
  const ctx: Ctx = { blocks: [] };
  const text = tidy(renderChildren(root, ctx));
  return restoreBlocks(text, ctx.blocks);
}

function restoreBlocks(text: string, blocks: string[]): string {
  const re = new RegExp(`^([ >\\t]*)${OPEN}(\\d+)${CLOSE}`, 'gm');
  const withPrefix = text.replace(re, (_m, prefix: string, i: string) =>
    (blocks[Number(i)] ?? '')
      .split('\n')
      .map((line) => prefix + line)
      .join('\n'),
  );
  return withPrefix.replace(new RegExp(`${OPEN}(\\d+)${CLOSE}`, 'g'), (_m, i: string) => blocks[Number(i)] ?? '');
}

function tidy(s: string): string {
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function renderChildren(node: Node, ctx: Ctx): string {
  let out = '';
  node.childNodes.forEach((child) => {
    out += renderNode(child, ctx);
  });
  return out;
}

function inline(node: Node, ctx: Ctx): string {
  return renderChildren(node, ctx).replace(/\s*\n\s*/g, ' ').trim();
}

function longestRun(s: string, ch: string): number {
  let max = 0;
  let cur = 0;
  for (const c of s) {
    cur = c === ch ? cur + 1 : 0;
    if (cur > max) max = cur;
  }
  return max;
}

function wrapInline(inner: string, mark: string): string {
  const t = inner.trim();
  if (!t) return '';
  return `${inner.startsWith(' ') ? ' ' : ''}${mark}${t}${mark}${inner.endsWith(' ') ? ' ' : ''}`;
}

function texOf(el: Element): string | null {
  return el.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim() || null;
}

function renderNode(node: Node, ctx: Ctx): string {
  if (node.nodeType === TEXT_NODE) {
    const t = node.textContent ?? '';
    if (!t.trim() && t.includes('\n')) return ''; // formatting whitespace between tags
    return t.replace(/\s+/g, ' ');
  }
  if (node.nodeType !== ELEMENT_NODE) return '';

  const el = node as Element;
  const tag = el.tagName.toUpperCase();

  // Math (KaTeX): keep the TeX source instead of the duplicated visual layout.
  if (el.classList.contains('katex-display')) {
    const tex = texOf(el);
    if (tex) return `\n\n$$\n${tex}\n$$\n\n`;
  }
  if (el.classList.contains('katex')) {
    const tex = texOf(el);
    if (tex) return `$${tex}$`;
  }

  if (SKIP_TAGS.has(tag) || el.classList.contains('sr-only') || el.getAttribute('aria-hidden') === 'true') return '';

  switch (tag) {
    case 'PRE': {
      const codeEl = el.querySelector('code');
      const body = (codeEl ?? el).textContent?.replace(/\n+$/, '') ?? '';
      const lang =
        /language-([\w#+.-]+)/.exec(codeEl?.getAttribute('class') ?? '')?.[1] ??
        /^[\w#+.-]{1,24}$/.exec(el.getAttribute('data-language') ?? '')?.[0] ??
        '';
      const fence = '`'.repeat(Math.max(3, longestRun(body, '`') + 1));
      ctx.blocks.push(`${fence}${lang}\n${body}\n${fence}`);
      return `\n\n${OPEN}${ctx.blocks.length - 1}${CLOSE}\n\n`;
    }
    case 'CODE': {
      const text = el.textContent ?? '';
      if (!text) return '';
      const fence = '`'.repeat(longestRun(text, '`') + 1);
      const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
      return `${fence}${pad}${text}${pad}${fence}`;
    }
    case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': {
      const text = inline(el, ctx);
      return text ? `\n\n${'#'.repeat(Number(tag[1]))} ${text}\n\n` : '';
    }
    case 'P':
      return `\n\n${renderChildren(el, ctx)}\n\n`;
    case 'BR':
      return '\n';
    case 'HR':
      return '\n\n---\n\n';
    case 'UL':
    case 'OL':
      return renderList(el, ctx, tag === 'OL');
    case 'BLOCKQUOTE': {
      const body = tidy(renderChildren(el, ctx));
      return body ? `\n\n${body.split('\n').map((l) => `> ${l}`).join('\n')}\n\n` : '';
    }
    case 'TABLE':
      return renderTable(el, ctx);
    case 'A': {
      const text = renderChildren(el, ctx).trim();
      const href = el.getAttribute('href') ?? '';
      if (!text) return '';
      return /^https?:\/\//.test(href) && href !== text ? `[${text}](${href})` : text;
    }
    case 'STRONG': case 'B':
      return wrapInline(renderChildren(el, ctx), '**');
    case 'EM': case 'I':
      return wrapInline(renderChildren(el, ctx), '*');
    case 'DEL': case 'S':
      return wrapInline(renderChildren(el, ctx), '~~');
    case 'IMG': {
      const alt = el.getAttribute('alt')?.trim();
      return alt ? `[image: ${alt}]` : '[image]';
    }
    default: {
      const inner = renderChildren(el, ctx);
      return BLOCK_TAGS.has(tag) ? `\n${inner}\n` : inner;
    }
  }
}

function renderList(el: Element, ctx: Ctx, ordered: boolean): string {
  const items = Array.from(el.children).filter((c) => c.tagName.toUpperCase() === 'LI');
  const start = ordered ? Number(el.getAttribute('start') ?? 1) || 1 : 0;
  const lines = items.map((li, i) => {
    const prefix = ordered ? `${start + i}. ` : '- ';
    const pad = ' '.repeat(prefix.length);
    const body = tidy(renderChildren(li, ctx)).replace(/\n{2,}/g, '\n');
    return (
      prefix +
      body
        .split('\n')
        .map((line, j) => (j === 0 || !line ? line : pad + line))
        .join('\n')
    );
  });
  return lines.length ? `\n\n${lines.join('\n')}\n\n` : '';
}

function renderTable(el: Element, ctx: Ctx): string {
  const rows = Array.from(el.querySelectorAll('tr')).map((tr) =>
    Array.from(tr.children)
      .filter((c) => ['TH', 'TD'].includes(c.tagName.toUpperCase()))
      .map((c) => renderChildren(c, ctx).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim()),
  );
  const width = Math.max(0, ...rows.map((r) => r.length));
  if (!width) return '';
  const fixed = rows.map((r) => [...r, ...Array<string>(width - r.length).fill('')]);
  const [head, ...rest] = fixed as [string[], ...string[][]];
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return `\n\n${[line(head), line(head.map(() => '---')), ...rest.map(line)].join('\n')}\n\n`;
}
