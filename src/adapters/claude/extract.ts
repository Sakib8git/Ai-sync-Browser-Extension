import { cleanTitle } from '../title';
import { findScroller, sweepScroller, waitFor } from '../dom';
import {
  ExtractionError,
  type ExtractedConversation,
  type ExtractedMessage,
  type ExtractionWarning,
} from '../../shared/conversation';
import { MESSAGE_SELECTOR, SELECTORS, readMessage, topLevelMessages, type Draft } from './read';
import { RowList, rowOf, sweepRows, type SweepConfig } from './rows';

export interface ExtractOptions {
  loadTimeoutMs?: number;
  /** Quiet time after each scroll before reading. */
  scrollSettleMs?: number;
  /** Longest wait for one scroll to settle. */
  maxSettleMs?: number;
  /** Overall sweep budget; when exceeded the result is marked unverified. */
  maxTotalMs?: number;
}

const DOCUMENT_POSITION_FOLLOWING = 4;
const conversationIdFromUrl = (url: URL) => /\/chat\/([\w-]+)/.exec(url.pathname)?.[1] ?? null;

function findTitle(doc: Document): string | null {
  const fromTab = cleanTitle(doc.title, ['Claude']);
  if (fromTab) return fromTab;
  return doc.querySelector(SELECTORS.titleButton)?.textContent?.trim() || null;
}

interface Gathered {
  drafts: Draft[];
  skippedRows: number;
  strategy: 'row-index' | 'dom-order';
  reachedTop: boolean;
  reachedBottom: boolean;
  /** Row numbering proved the first message was reached (row-index strategy only). */
  earliestVerified: boolean;
  missingRows: number;
  /** Page-order fallback only: unloaded messages were ordered by scroll position. */
  orderEstimated: boolean;
  rowRange?: { first: number; last: number; count: number };
}

/** Preferred path: the page exposes `data-index` row numbers, so completeness can be verified. */
async function gatherByRowIndex(
  doc: Document,
  scroller: HTMLElement | null,
  firstRow: Element,
  cfg: SweepConfig,
): Promise<Gathered> {
  const swept = await sweepRows(scroller, new RowList(doc, firstRow), cfg);
  const indexes = [...swept.rows.keys()].sort((a, b) => a - b);
  const first = indexes[0] ?? 0;
  const last = indexes[indexes.length - 1] ?? 0;
  let missingRows = 0;
  for (let i = first; i <= last; i++) if (!swept.rows.has(i)) missingRows++;

  const drafts: Draft[] = [];
  let skippedRows = 0;
  for (const index of indexes) {
    const row = swept.rows.get(index);
    if (!row) continue;
    drafts.push(...row.drafts);
    skippedRows += row.emptyMessages + (row.drafts.length === 0 && row.emptyMessages === 0 ? 1 : 0);
  }
  return {
    drafts,
    skippedRows,
    strategy: 'row-index',
    reachedTop: swept.reachedTop,
    reachedBottom: swept.reachedBottom,
    earliestVerified: swept.reachedTop && first === 0,
    missingRows,
    orderEstimated: false,
    rowRange: { first, last, count: indexes.length },
  };
}

/** Fallback: no row numbers on the page. Page order is used and completeness is checked more loosely. */
async function gatherByPageOrder(doc: Document, scroller: HTMLElement | null, cfg: SweepConfig): Promise<Gathered> {
  const drafts = new Map<Element, Draft>();
  const emptyRows = new Set<Element>();
  const collect = () => {
    for (const el of topLevelMessages(doc.documentElement)) {
      const result = readMessage(el, scroller);
      if ('empty' in result) {
        emptyRows.add(el);
        continue;
      }
      const existing = drafts.get(el);
      if (!existing || result.content.length >= existing.content.length) drafts.set(el, result);
    }
  };

  let reachedTop = true;
  let reachedBottom = true;
  if (scroller) {
    const reach = await sweepScroller(scroller, cfg.settleMs, collect);
    reachedTop = reach.reachedTop;
    reachedBottom = reach.reachedBottom;
  } else {
    collect();
  }

  // Messages still on the page are authoritative. Ones Claude removed while we scrolled are kept
  // (never silently dropped) unless they are just an earlier copy of a message that was re-rendered.
  const keyOf = (d: Draft) => `${d.role}\u0000${d.content}`;
  const entries = [...drafts.entries()];
  const liveKeys = new Set(entries.filter(([el]) => el.isConnected).map(([, d]) => keyOf(d)));
  const keptDetached = new Set<string>();
  const kept = entries.filter(([el, d]) => {
    if (el.isConnected) return true;
    const key = keyOf(d);
    if (liveKeys.has(key) || keptDetached.has(key)) return false;
    keptDetached.add(key);
    return true;
  });
  const orderEstimated = kept.some(([el]) => !el.isConnected);
  kept.sort(
    orderEstimated
      ? (a, b) => a[1].offset - b[1].offset
      : (a, b) => (a[0] === b[0] ? 0 : a[0].compareDocumentPosition(b[0]) & DOCUMENT_POSITION_FOLLOWING ? -1 : 1),
  );

  return {
    drafts: kept.map(([, d]) => d),
    skippedRows: [...emptyRows].filter((el) => !drafts.has(el)).length,
    strategy: 'dom-order',
    reachedTop,
    reachedBottom,
    earliestVerified: false,
    missingRows: 0,
    orderEstimated,
  };
}

export async function extractClaudeConversation(
  doc: Document,
  url: URL,
  options: ExtractOptions = {},
): Promise<ExtractedConversation> {
  const { loadTimeoutMs = 5000, scrollSettleMs = 120, maxSettleMs = 2500, maxTotalMs = 120_000 } = options;
  const cfg: SweepConfig = { settleMs: scrollSettleMs, maxSettleMs, maxTotalMs };

  if (!conversationIdFromUrl(url)) {
    throw new ExtractionError('NOT_A_CONVERSATION', 'Open a Claude conversation first, then try again.');
  }

  const appeared = await waitFor(() => doc.querySelector(MESSAGE_SELECTOR) !== null, loadTimeoutMs);
  const first = doc.querySelector(MESSAGE_SELECTOR);
  if (!appeared || !first) {
    throw new ExtractionError(
      'NO_MESSAGES',
      'Could not read this conversation. No messages were found. The page may still be loading, or Claude may have changed its interface.',
    );
  }

  const scroller = findScroller(doc, first);
  const firstRow = rowOf(first);
  const g = firstRow
    ? await gatherByRowIndex(doc, scroller, firstRow, cfg)
    : await gatherByPageOrder(doc, scroller, cfg);

  if (g.drafts.length === 0) {
    throw new ExtractionError('NO_MESSAGES', 'Could not read this conversation. Messages were found but contained no readable text.');
  }

  const messages: ExtractedMessage[] = g.drafts.map((d, index) => ({
    index,
    id: null, // Claude does not expose stable message ids in the page
    role: d.role,
    content: d.content || '[No text. This message contained only an attachment or artifact.]',
  }));

  const warnings: ExtractionWarning[] = [];

  if (SELECTORS.generating.some((s) => doc.querySelector(s))) {
    warnings.push({
      code: 'STILL_GENERATING',
      severity: 'warning',
      message: 'Claude is still writing a reply, so the last message may be cut off. Wait for it to finish and read again.',
    });
  }

  // Completeness. Each check either proves something or produces a warning; none is assumed.
  const hasScroller = scroller !== null;
  if (g.strategy === 'row-index') {
    if (!g.earliestVerified) {
      warnings.push({
        code: 'EARLIEST_NOT_VERIFIED',
        severity: 'warning',
        message: 'Could not confirm that the start of the conversation was reached, so earlier messages may be missing.',
      });
    }
    if (g.missingRows > 0) {
      warnings.push({
        code: 'ROWS_MISSING',
        severity: 'warning',
        message: `${g.missingRows} part(s) of the conversation never loaded on screen, so some messages may be missing.`,
      });
    }
    if (!g.reachedBottom) {
      warnings.push({
        code: 'LATEST_NOT_VERIFIED',
        severity: 'warning',
        message: 'Could not confirm that the end of the conversation was reached, so the latest messages may be missing.',
      });
    }
    if (g.earliestVerified && g.drafts[0]?.role === 'assistant') {
      warnings.push({
        code: 'STARTS_WITH_ASSISTANT',
        severity: 'info',
        message: 'The conversation begins with an AI message. The start was verified, so nothing earlier is missing.',
      });
    }
  } else {
    if (hasScroller && !g.reachedTop) {
      warnings.push({
        code: 'EARLIEST_NOT_VERIFIED',
        severity: 'warning',
        message: 'Could not confirm that the start of the conversation was reached, so earlier messages may be missing.',
      });
    }
    if (hasScroller && !g.reachedBottom) {
      warnings.push({
        code: 'LATEST_NOT_VERIFIED',
        severity: 'warning',
        message: 'Could not confirm that the end of the conversation was reached, so the latest messages may be missing.',
      });
    }
    if (g.orderEstimated) {
      warnings.push({
        code: 'UNLOADED_MESSAGES',
        severity: 'warning',
        message:
          'Claude removed some messages from the page while scrolling. They were kept, but their order is estimated from scroll position. Check the order before relying on it.',
      });
    }
    if (g.drafts[0]?.role === 'assistant') {
      warnings.push({
        code: 'STARTS_WITH_ASSISTANT',
        severity: 'warning',
        message: 'The conversation begins with an AI message, so earlier messages may not have loaded.',
      });
    }
  }

  if (g.skippedRows > 0) {
    warnings.push({
      code: 'EMPTY_ROWS_SKIPPED',
      severity: 'info',
      message: `${g.skippedRows} empty row(s) were skipped. These are usually status or thinking-only rows with no message text.`,
    });
  }

  const attachmentMessages = g.drafts.filter((d) => d.attachments > 0).length;
  if (attachmentMessages > 0) {
    warnings.push({
      code: 'IMAGES_NOT_CAPTURED',
      severity: 'info',
      message: `${attachmentMessages} message(s) appear to include images or attachments. Their text is captured, but the attachments are not.`,
    });
  }

  const artifactMessages = g.drafts.filter((d) => d.artifacts > 0).length;
  if (artifactMessages > 0) {
    warnings.push({
      code: 'ARTIFACTS_NOT_CAPTURED',
      severity: 'info',
      message: `${artifactMessages} message(s) appear to include Claude artifacts or files. The chat text is captured, but the artifact contents are not.`,
    });
  }

  if (g.drafts.some((d) => d.usedFallback)) {
    warnings.push({
      code: 'BODY_FALLBACK',
      severity: 'info',
      message: 'Some replies were read from the whole message area because the usual text container was not found. They may include extra interface text.',
    });
  }

  return {
    schemaVersion: 1,
    provider: 'claude',
    conversationId: conversationIdFromUrl(url),
    title: findTitle(doc),
    url: url.href,
    extractedAt: new Date().toISOString(),
    messages,
    warnings,
    complete: !warnings.some((w) => w.severity === 'warning'),
    diagnostics: {
      strategy: g.strategy,
      reachedTop: g.reachedTop,
      reachedBottom: g.reachedBottom,
      ...(g.rowRange && { rowsRead: g.rowRange.count, firstRow: g.rowRange.first, lastRow: g.rowRange.last }),
      ...(g.strategy === 'row-index' && { missingRows: g.missingRows }),
    },
  };
}
