import { cleanTitle } from '../title';
import { domToMarkdown } from '../markdown';
import { findScroller, sweepScroller, waitFor } from '../dom';
import {
  ExtractionError,
  type ExtractedConversation,
  type ExtractedMessage,
  type ExtractionWarning,
  type MessageRole,
} from '../../shared/conversation';

/**
 * ChatGPT DOM knowledge lives ONLY in this file. If ChatGPT changes its markup, update the
 * selectors below. They rely on data attributes, which change far less often than CSS classes.
 */
const SELECTORS = {
  message: '[data-message-author-role="user"], [data-message-author-role="assistant"]',
  turn: '[data-testid^="conversation-turn"]',
  assistantBody: '.markdown',
  userBody: '.whitespace-pre-wrap',
  generating: ['[data-testid="stop-button"]', 'button[aria-label="Stop streaming"]', 'button[aria-label="Stop generating"]'],
} as const;

export interface ExtractOptions {
  /** How long to wait for messages to appear on a freshly loaded page. */
  loadTimeoutMs?: number;
  /** Pause after each scroll step so lazy content can render. */
  scrollSettleMs?: number;
}

interface Draft {
  sortKey: number;
  id: string | null;
  role: MessageRole;
  content: string;
  images: number;
}

const conversationIdFromUrl = (url: URL) => /\/c\/([\w-]+)/.exec(url.pathname)?.[1] ?? null;
const turnNumber = (turn: Element | null) => {
  const m = /conversation-turn-(\d+)/.exec(turn?.getAttribute('data-testid') ?? '');
  return m?.[1] ? Number(m[1]) : null;
};

function readMessage(el: Element, order: number): { key: string; draft: Draft; turn: number | null } {
  const role = el.getAttribute('data-message-author-role') as MessageRole;
  const turnEl = el.closest(SELECTORS.turn);
  const turn = turnNumber(turnEl);
  const posInTurn = turnEl ? Array.from(turnEl.querySelectorAll(SELECTORS.message)).indexOf(el) : 0;
  const id = el.getAttribute('data-message-id');

  let content: string;
  if (role === 'assistant') {
    const bodies = Array.from(el.querySelectorAll(SELECTORS.assistantBody)).filter(
      (b) => !b.parentElement?.closest(SELECTORS.assistantBody),
    );
    content = (bodies.length ? bodies : [el]).map((b) => domToMarkdown(b)).filter(Boolean).join('\n\n');
  } else {
    const body = el.querySelector(SELECTORS.userBody) ?? el;
    content = (body.textContent ?? '').trim(); // user text is plain; whitespace is meaningful
  }

  return {
    key: id ?? (turn !== null ? `t${turn}-${posInTurn}` : `o${order}`),
    turn,
    draft: {
      sortKey: turn !== null ? turn * 1000 + posInTurn : 1e9 + order,
      id,
      role,
      content,
      images: (turnEl ?? el).querySelectorAll('img').length,
    },
  };
}

interface Collected {
  drafts: Map<string, Draft>;
  seenTurns: Set<number>;
  unorderedSeen: boolean;
}

function collectVisible(doc: Document, into: Collected): void {
  doc.querySelectorAll(SELECTORS.turn).forEach((t) => {
    const n = turnNumber(t);
    if (n !== null) into.seenTurns.add(n);
  });
  let order = into.drafts.size;
  doc.querySelectorAll(SELECTORS.message).forEach((el) => {
    const { key, draft, turn } = readMessage(el, order++);
    if (turn === null) into.unorderedSeen = true;
    const existing = into.drafts.get(key);
    // Keep the fullest version: a message that was streaming earlier may have grown since.
    if (!existing || draft.content.length >= existing.content.length) into.drafts.set(key, draft);
  });
}

function findTitle(doc: Document, url: URL): string | null {
  const fromTab = cleanTitle(doc.title, ['ChatGPT']);
  if (fromTab) return fromTab;
  const id = conversationIdFromUrl(url);
  const link = id ? doc.querySelector(`nav a[href*="/c/${id}"]`) : null;
  return link?.textContent?.trim() || null;
}

export async function extractChatGptConversation(
  doc: Document,
  url: URL,
  options: ExtractOptions = {},
): Promise<ExtractedConversation> {
  const { loadTimeoutMs = 5000, scrollSettleMs = 120 } = options;

  if (!conversationIdFromUrl(url)) {
    throw new ExtractionError('NOT_A_CONVERSATION', 'Open a ChatGPT conversation first, then try again.');
  }

  const appeared = await waitFor(() => doc.querySelector(SELECTORS.message) !== null, loadTimeoutMs);
  const first = doc.querySelector(SELECTORS.message);
  if (!appeared || !first) {
    throw new ExtractionError(
      'NO_MESSAGES',
      'Could not read this conversation. No messages were found. The page may still be loading, or ChatGPT may have changed its interface.',
    );
  }

  const collected: Collected = { drafts: new Map(), seenTurns: new Set(), unorderedSeen: false };
  const scroller = findScroller(doc, first);
  if (scroller) await sweepScroller(scroller, scrollSettleMs, () => collectVisible(doc, collected));
  else collectVisible(doc, collected);

  const sorted = [...collected.drafts.values()]
    .filter((d) => d.content || d.images > 0)
    .sort((a, b) => a.sortKey - b.sortKey);

  const messages: ExtractedMessage[] = sorted.map((d, index) => ({
    index,
    id: d.id,
    role: d.role,
    content: d.content || '[No text. This message contained only an image or attachment.]',
  }));

  if (messages.length === 0) {
    throw new ExtractionError('NO_MESSAGES', 'Could not read this conversation. Messages were found but contained no readable text.');
  }

  const warnings: ExtractionWarning[] = [];

  if (SELECTORS.generating.some((s) => doc.querySelector(s))) {
    warnings.push({
      code: 'STILL_GENERATING',
      severity: 'warning',
      message: 'ChatGPT is still writing a reply, so the last message may be cut off. Wait for it to finish and read again.',
    });
  }

  const turns = [...collected.seenTurns].sort((a, b) => a - b);
  const first_ = turns[0];
  const last_ = turns[turns.length - 1];
  if (first_ !== undefined && last_ !== undefined) {
    const missing: number[] = [];
    for (let n = first_; n <= last_; n++) if (!collected.seenTurns.has(n)) missing.push(n);
    if (missing.length) {
      warnings.push({
        code: 'MISSING_TURNS',
        severity: 'warning',
        message: `${missing.length} part(s) of the conversation never loaded on screen, so some messages may be missing.`,
      });
    }
  }

  if (collected.unorderedSeen && collected.drafts.size > 1) {
    warnings.push({
      code: 'ORDER_UNVERIFIED',
      severity: 'warning',
      message: 'Message order could not be verified against ChatGPT’s own numbering.',
    });
  }

  if (messages[0]?.role === 'assistant') {
    warnings.push({
      code: 'STARTS_WITH_ASSISTANT',
      severity: 'warning',
      message: 'The conversation begins with an AI message, so earlier messages may not have loaded.',
    });
  }

  const imageMessages = sorted.filter((d) => d.images > 0).length;
  if (imageMessages > 0) {
    warnings.push({
      code: 'IMAGES_NOT_CAPTURED',
      severity: 'info',
      message: `${imageMessages} message(s) include images or attachments. Their text is captured, but the images are not.`,
    });
  }

  return {
    schemaVersion: 1,
    provider: 'chatgpt',
    conversationId: conversationIdFromUrl(url),
    title: findTitle(doc, url),
    url: url.href,
    extractedAt: new Date().toISOString(),
    messages,
    warnings,
    complete: !warnings.some((w) => w.severity === 'warning'),
  };
}
