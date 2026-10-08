import { cleanTitle } from '../title';
import {
  captureViewAnchor,
  findScroller,
  loadOlder,
  restoreViewAnchor,
  setScrollTop,
  sweepScroller,
  waitFor,
} from '../dom';
import { collapseRenderDuplicates, resolvePageOrder } from '../pageOrder';
import {
  ExtractionError,
  type ExtractedConversation,
  type ExtractedMessage,
  type ExtractionWarning,
} from '../../shared/conversation';
import { MESSAGE_SELECTOR, SELECTORS, readMessage, topLevelMessages, type Draft } from './read';

export interface ExtractOptions {
  loadTimeoutMs?: number;
  /** Quiet time after each scroll before reading. */
  scrollSettleMs?: number;
  /** Longest wait for one scroll to settle. */
  maxSettleMs?: number;
  /** How long the top of the chat must stay unchanged before we trust that nothing older exists. */
  topPatienceMs?: number;
  /** Overall budget for loading older messages; when exceeded the result is marked unverified. */
  maxTotalMs?: number;
}

const conversationIdFromUrl = (url: URL) =>
  (/\/app\/([\w-]+)/.exec(url.pathname) ?? /\/gem\/[\w-]+\/([\w-]+)/.exec(url.pathname))?.[1] ?? null;

function findTitle(doc: Document): string | null {
  const fromTab = cleanTitle(doc.title, ['Google Gemini', 'Gemini']);
  if (fromTab) return fromTab;
  for (const selector of SELECTORS.selectedTitle) {
    const text = doc.querySelector(selector)?.textContent?.trim();
    if (text) return text;
  }
  return null;
}

/** The transcript scroller: the known element when it really scrolls, else the nearest scrollable ancestor. */
function findGeminiScroller(doc: Document, first: Element): HTMLElement | null {
  const known = doc.querySelector<HTMLElement>(SELECTORS.scroller);
  if (known && known.scrollHeight > known.clientHeight + 1) return known;
  return findScroller(doc, first);
}

const fingerprint = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
const keyOf = (d: Draft) => `${d.role}\u0000${d.content}`;

export async function extractGeminiConversation(
  doc: Document,
  url: URL,
  options: ExtractOptions = {},
): Promise<ExtractedConversation> {
  const {
    loadTimeoutMs = 5000,
    scrollSettleMs = 150,
    maxSettleMs = 2500,
    topPatienceMs = 2500,
    maxTotalMs = 120_000,
  } = options;

  if (!conversationIdFromUrl(url)) {
    throw new ExtractionError('NOT_A_CONVERSATION', 'Open a Gemini conversation first, then try again.');
  }

  const appeared = await waitFor(() => doc.querySelector(MESSAGE_SELECTOR) !== null, loadTimeoutMs);
  const first = doc.querySelector(MESSAGE_SELECTOR);
  if (!appeared || !first) {
    throw new ExtractionError(
      'NO_MESSAGES',
      'Could not read this conversation. No messages were found. The page may still be loading, or Gemini may have changed its interface.',
    );
  }

  const startedAt = Date.now();
  const scroller = findGeminiScroller(doc, first);
  const collected = new Map<Element, Draft>();
  const emptyRows = new Set<Element>();
  const mounted = () => topLevelMessages(doc.documentElement);
  const collect = () => {
    for (const el of mounted()) {
      const result = readMessage(el, scroller);
      if ('empty' in result) {
        emptyRows.add(el);
        continue;
      }
      const existing = collected.get(el);
      // Keep the fullest version: a reply that was streaming earlier may have grown since.
      if (!existing || result.content.length >= existing.content.length) collected.set(el, result);
    }
  };

  let reachedTop = true;
  let reachedBottom = true;
  let loadRounds = 0;
  if (scroller) {
    const signature = () => {
      const els = mounted();
      return `${els.length}|${els.reduce((n, e) => n + (e.textContent ?? '').length, 0)}`;
    };
    const anchor = captureViewAnchor(scroller, mounted, fingerprint);
    try {
      const load = await loadOlder(scroller, {
        signature,
        collect,
        settleMs: scrollSettleMs,
        maxSettleMs,
        patienceMs: topPatienceMs,
        maxTotalMs,
      });
      reachedTop = load.reachedTop;
      loadRounds = load.rounds;
      const reach = await sweepScroller(scroller, scrollSettleMs, collect);
      reachedBottom = reach.reachedBottom;
    } finally {
      try {
        await restoreViewAnchor(scroller, anchor, mounted, fingerprint, signature, scrollSettleMs, maxSettleMs);
      } catch {
        setScrollTop(scroller, scroller.scrollTop);
      }
    }
  } else {
    collect();
  }

  const ordered = resolvePageOrder([...collected.entries()], keyOf);
  const deduped = collapseRenderDuplicates(ordered.items);
  const drafts = deduped.items;
  const skippedRows = [...emptyRows].filter((el) => !collected.has(el)).length;

  if (drafts.length === 0) {
    throw new ExtractionError('NO_MESSAGES', 'Could not read this conversation. Messages were found but contained no readable text.');
  }

  const messages: ExtractedMessage[] = drafts.map((d, index) => ({
    index,
    id: null, // Gemini does not expose stable message ids in the page
    role: d.role,
    content: d.content || '[No text. This message contained only an attachment or generated content.]',
  }));

  const warnings: ExtractionWarning[] = [];

  if (SELECTORS.generating.some((s) => doc.querySelector(s))) {
    warnings.push({
      code: 'STILL_GENERATING',
      severity: 'warning',
      message: 'Gemini is still writing a reply, so the last message may be cut off. Wait for it to finish and read again.',
    });
  }

  // Gemini has no row numbers, so completeness cannot be proven; it is established by evidence
  // (top stayed unchanged, bottom reached, first message is the user's, nothing was unmounted).
  if (scroller && !reachedTop) {
    warnings.push({
      code: 'EARLIEST_NOT_VERIFIED',
      severity: 'warning',
      message:
        'Gemini was still loading older messages when reading stopped, so the start of the conversation could not be confirmed. Read again, or scroll to the top of the chat first.',
    });
  }
  if (scroller && !reachedBottom) {
    warnings.push({
      code: 'LATEST_NOT_VERIFIED',
      severity: 'warning',
      message: 'Could not confirm that the end of the conversation was reached, so the latest messages may be missing.',
    });
  }
  if (ordered.estimated) {
    warnings.push({
      code: 'UNLOADED_MESSAGES',
      severity: 'warning',
      message:
        'Gemini removed some messages from the page while scrolling. They were kept, but their order is estimated from scroll position. Check the order before relying on it.',
    });
  }
  if (drafts[0]?.role === 'assistant') {
    warnings.push({
      code: 'STARTS_WITH_ASSISTANT',
      severity: 'warning',
      message: 'The first message found is from Gemini, so the start of the conversation may be missing.',
    });
  }
  if (skippedRows > 0) {
    warnings.push({
      code: 'EMPTY_ROWS_SKIPPED',
      severity: 'info',
      message: `${skippedRows} empty row(s) were skipped. These are usually status or thinking-only rows with no message text.`,
    });
  }
  if (deduped.removed > 0) {
    warnings.push({
      code: 'DUPLICATES_COLLAPSED',
      severity: 'info',
      message: `${deduped.removed} duplicate render(s) of the same message were merged, keeping the fuller copy.`,
    });
  }
  const attachmentMessages = drafts.filter((d) => d.attachments > 0).length;
  if (attachmentMessages > 0) {
    warnings.push({
      code: 'IMAGES_NOT_CAPTURED',
      severity: 'info',
      message: `${attachmentMessages} message(s) appear to include images or attachments. Their text is captured, but the attachments are not.`,
    });
  }
  const artifactMessages = drafts.filter((d) => d.artifacts > 0).length;
  if (artifactMessages > 0) {
    warnings.push({
      code: 'ARTIFACTS_NOT_CAPTURED',
      severity: 'info',
      message: `${artifactMessages} message(s) appear to include Canvas or generated documents. The chat text is captured, but their contents are not.`,
    });
  }
  if (drafts.some((d) => d.usedFallback)) {
    warnings.push({
      code: 'BODY_FALLBACK',
      severity: 'info',
      message: 'Some replies were read from the whole message area because the usual text container was not found. They may include extra interface text.',
    });
  }

  return {
    schemaVersion: 1,
    provider: 'gemini',
    conversationId: conversationIdFromUrl(url),
    title: findTitle(doc),
    url: url.href,
    extractedAt: new Date().toISOString(),
    messages,
    warnings,
    complete: !warnings.some((w) => w.severity === 'warning'),
    diagnostics: {
      strategy: 'dom-order',
      reachedTop,
      reachedBottom,
      startEvidence: !scroller ? 'not-scrollable' : reachedTop ? 'top-stable' : 'not-verified',
      loadRounds,
      messagesRead: messages.length,
      duplicatesCollapsed: deduped.removed,
      scrollerFound: scroller !== null,
      elapsedMs: Date.now() - startedAt,
    },
  };
}
