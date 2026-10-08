import { domToMarkdown } from '../markdown';
import { domToPlainText } from '../plaintext';
import type { MessageRole } from '../../shared/conversation';

/**
 * Gemini DOM knowledge for reading ONE message lives here. If gemini.google.com changes its
 * markup, update the selectors below. Entries marked (reported) come from third-party exporters
 * and userscripts; entries marked (guess) are best-effort and degrade into warnings, not failures.
 */
export const SELECTORS = {
  /** (reported) The scrolling transcript. */
  scroller: 'infinite-scroller[data-test-id="chat-history-container"], infinite-scroller.chat-history',
  /** (reported) Custom elements for one question / one answer. */
  user: 'user-query, .user-query-container',
  assistant: 'model-response, response-container',
  /** (reported) One question+answer pair. Only used for the optional turn-level attachment scope. */
  turn: '.conversation-container',
  /** (reported) The user's text: one <p class="query-text-line"> per line. */
  queryText: '.query-text',
  queryLine: 'p.query-text-line',
  /** (reported) Rendered answer text. */
  body: '.markdown',
  bodyFallback: 'message-content, .response-content',
  /** (guess) Interface that must not leak into message text. */
  chrome: [
    '.cdk-visually-hidden',
    '.sr-only',
    'button',
    'copy-button',
    'message-actions',
    'sources-list',
    'sources-carousel-inline',
    'thinking-overlay',
    'model-thoughts',
    'sensitive-memories-banner',
    '.table-footer',
    'sup[data-turn-source-index]',
    'source-footnote',
  ].join(', '),
  /** (guess) Language label shown above a code block. */
  codeBlock: 'code-block',
  codeDecoration: '.code-block-decoration',
  /** (guess) Math: Gemini keeps the TeX source in a data-math attribute. */
  math: '[data-math]',
  /** (guess) Heuristics for content we cannot capture yet. */
  userAttachment: 'img, uploader-file-preview, user-query-file-preview, [class*="file-preview"]',
  modelImage: 'generated-image, single-image, [data-test-id="image-card"], .markdown img',
  artifact: 'immersive-entry-chip, [data-test-id="immersive-entry-chip"]',
  /** (guess) A reply is still being written. */
  generating: ['button[aria-label="Stop response"]', 'button[aria-label="Stop generating"]', 'button.send-button.stop', 'model-response [aria-busy="true"]'],
  /** (guess) The highlighted conversation in the sidebar, used only when the tab title is generic. */
  selectedTitle: ['.selected .conversation-title', '[aria-current="page"] .conversation-title'],
} as const;

export const MESSAGE_SELECTOR = `${SELECTORS.user}, ${SELECTORS.assistant}`;

export interface Draft {
  role: MessageRole;
  content: string;
  attachments: number;
  artifacts: number;
  /** Vertical position inside the scroller when last seen. Only used if the page unmounts messages. */
  offset: number;
  usedFallback: boolean;
}

/** Message elements under `root` that are not nested inside another message element, in page order. */
export function topLevelMessages(root: Element): Element[] {
  return Array.from(root.querySelectorAll(MESSAGE_SELECTOR)).filter(
    (el) => !el.parentElement?.closest(MESSAGE_SELECTOR),
  );
}

/** Works on a CLONE: label code blocks, keep math source, then strip interface elements. */
function prepare(source: Element): Element {
  const doc = source.ownerDocument;
  const clone = source.cloneNode(true) as Element;

  clone.querySelectorAll(SELECTORS.codeBlock).forEach((block) => {
    const label = block.querySelector(`${SELECTORS.codeDecoration} span`)?.textContent?.trim() ?? '';
    const pre = block.querySelector('pre');
    if (pre && label) {
      const hasLanguage = /language-/.test(pre.querySelector('code')?.getAttribute('class') ?? '') || pre.hasAttribute('data-language');
      if (!hasLanguage) pre.setAttribute('data-language', label.toLowerCase());
    }
    block.querySelector(SELECTORS.codeDecoration)?.remove();
  });

  // Re-express math as the structure the Markdown converter already understands.
  clone.querySelectorAll(SELECTORS.math).forEach((node) => {
    const tex = node.getAttribute('data-math');
    if (!tex) return;
    const wrapper = doc.createElement('span');
    wrapper.className = node.classList.contains('math-block') ? 'katex-display' : 'katex';
    const annotation = doc.createElement('annotation');
    annotation.setAttribute('encoding', 'application/x-tex');
    annotation.textContent = tex;
    wrapper.appendChild(annotation);
    node.replaceWith(wrapper);
  });

  clone.querySelectorAll(SELECTORS.chrome).forEach((n) => n.remove());
  return clone;
}

function readUserText(el: Element): string {
  const clone = prepare(el);
  const lines = Array.from(clone.querySelectorAll(SELECTORS.queryLine));
  if (lines.length) return lines.map((p) => (p.textContent ?? '').replace(/\u00a0/g, ' ')).join('\n').trim();
  return domToPlainText(clone.querySelector(SELECTORS.queryText) ?? clone).trim();
}

/** Reads one message element. Returns { empty: true } when it has no text, attachment or artifact. */
export function readMessage(el: Element, scroller: HTMLElement | null): Draft | { empty: true } {
  const role: MessageRole = el.matches(SELECTORS.user) ? 'user' : 'assistant';
  const attachments = el.querySelectorAll(role === 'user' ? SELECTORS.userAttachment : SELECTORS.modelImage).length;
  const artifacts = role === 'assistant' ? el.querySelectorAll(SELECTORS.artifact).length : 0;

  let content = '';
  let usedFallback = false;
  if (role === 'user') {
    content = readUserText(el);
  } else {
    const clone = prepare(el);
    const bodies = Array.from(clone.querySelectorAll(SELECTORS.body)).filter(
      (b) => !b.parentElement?.closest(SELECTORS.body),
    );
    if (bodies.length) {
      content = bodies.map((b) => domToMarkdown(b)).filter(Boolean).join('\n\n');
    } else {
      const holder = clone.querySelector(SELECTORS.bodyFallback) ?? clone;
      content = domToMarkdown(holder);
      usedFallback = content !== '';
    }
  }

  if (!content && attachments + artifacts === 0) return { empty: true };

  const offset = scroller
    ? el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
    : 0;
  return { role, content, attachments, artifacts, offset, usedFallback };
}
