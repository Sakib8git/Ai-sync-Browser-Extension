import { domToMarkdown } from '../markdown';
import { domToPlainText } from '../plaintext';
import type { MessageRole } from '../../shared/conversation';

/**
 * Claude DOM knowledge for reading ONE message lives here. If claude.ai changes its markup,
 * update the selectors below.
 */
export const SELECTORS = {
  user: '[data-testid="user-message"]',
  assistant: '.font-claude-response, [data-testid="assistant-message"]',
  assistantBody: '.standard-markdown, .progressive-markdown',
  /** Wrapper around one turn; used to find attachment/artifact cards that sit beside the text. */
  turn: '[data-test-render-count]',
  generating: ['[data-is-streaming="true"]', 'button[aria-label="Stop response"]', 'button[aria-label="Stop Response"]'],
  /** Heuristics: attachment thumbnails and artifact cards. Their contents are not captured. */
  attachment: '[data-testid="file-thumbnail"], img',
  artifact: '[data-testid*="artifact"], [class*="artifact-block"]',
  titleButton: '[data-testid="chat-title-button"]',
} as const;
export const MESSAGE_SELECTOR = `${SELECTORS.user}, ${SELECTORS.assistant}`;

const LANGUAGE_LABEL = /^[\w#+.-]{1,24}$/;
const BLOCKY = 'p, li, pre, table, ul, ol, h1, h2, h3, h4, h5, h6, blockquote';

export interface Draft {
  role: MessageRole;
  content: string;
  attachments: number;
  artifacts: number;
  /** Vertical position inside the scroller when last seen. Only used by the page-order fallback. */
  offset: number;
  usedFallback: boolean;
}

/** Message elements under `root` that are not nested inside another message element. */
export function topLevelMessages(root: Element): Element[] {
  if (root.matches(MESSAGE_SELECTOR)) return [root];
  return Array.from(root.querySelectorAll(MESSAGE_SELECTOR)).filter(
    (el) => !el.parentElement?.closest(MESSAGE_SELECTOR),
  );
}

/**
 * Claude wraps each code block with a header ("python" + Copy button). Remove that chrome from a
 * CLONE and keep the language as a hint so the fenced block comes out clean.
 */
function cleanCodeBlocks(root: Element): void {
  root.querySelectorAll('pre').forEach((pre) => {
    const wrapper = pre.parentElement;
    if (!wrapper || wrapper === root) return;
    const preLength = (pre.textContent ?? '').length;
    if ((wrapper.textContent ?? '').length - preLength > 40) return; // wrapper holds real content too
    let label = '';
    for (const sibling of Array.from(wrapper.children)) {
      if (sibling === pre || !/^(DIV|SPAN)$/.test(sibling.tagName.toUpperCase()) || sibling.querySelector(BLOCKY)) continue;
      const probe = sibling.cloneNode(true) as Element;
      probe.querySelectorAll('button').forEach((b) => b.remove());
      const text = (probe.textContent ?? '').trim();
      if (text === '') sibling.remove(); // toolbar only
      else if (LANGUAGE_LABEL.test(text)) {
        label = label || text;
        sibling.remove();
      }
    }
    const code = pre.querySelector('code');
    const hasLanguage = /language-/.test(code?.getAttribute('class') ?? '') || pre.hasAttribute('data-language');
    if (label && !hasLanguage) pre.setAttribute('data-language', label.toLowerCase());
  });
}

function toMarkdown(node: Element): string {
  const clone = node.cloneNode(true) as Element;
  cleanCodeBlocks(clone);
  return domToMarkdown(clone);
}

/** Reads one message element. Returns { empty: true } when it has no text, attachment or artifact. */
export function readMessage(el: Element, scroller: HTMLElement | null): Draft | { empty: true } {
  const role: MessageRole = el.matches(SELECTORS.user) ? 'user' : 'assistant';
  const scope = el.closest(SELECTORS.turn) ?? el;
  const attachments = scope.querySelectorAll(SELECTORS.attachment).length;
  const artifacts = scope.querySelectorAll(SELECTORS.artifact).length;

  let content = '';
  let usedFallback = false;
  if (role === 'user') {
    content = domToPlainText(el).trim();
  } else {
    const bodies = Array.from(el.querySelectorAll(SELECTORS.assistantBody)).filter(
      (b) => !b.parentElement?.closest(SELECTORS.assistantBody),
    );
    if (bodies.length) {
      content = bodies.map(toMarkdown).filter(Boolean).join('\n\n');
    } else {
      content = toMarkdown(el);
      usedFallback = content !== '';
    }
  }

  if (!content && attachments + artifacts === 0) return { empty: true };

  const offset = scroller
    ? el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
    : 0;
  return { role, content, attachments, artifacts, offset, usedFallback };
}
