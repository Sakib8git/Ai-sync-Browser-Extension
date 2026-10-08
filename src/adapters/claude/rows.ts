import { setScrollTop, settle } from '../dom';
import { MESSAGE_SELECTOR, readMessage, topLevelMessages, type Draft } from './read';

/**
 * Claude's transcript is a virtual list: only rows near the viewport are mounted, and every row
 * carries its global position in a `data-index` attribute. That number is the stable ordering
 * signal. It lets us (a) order messages without guessing from scroll geometry, (b) merge rows that
 * were unmounted and re-mounted without duplicates, and (c) PROVE completeness: index 0 reached,
 * no holes below the highest index, bottom reached.
 */
const MIN_STEP = 60;

export interface RowRecord {
  index: number;
  drafts: Draft[];
  /** Message elements in the row with no text, attachment or artifact. */
  emptyMessages: number;
  chars: number;
  offset: number;
  fingerprint: string;
}

export interface SweepConfig {
  /** Quiet time after a scroll before reading. */
  settleMs: number;
  /** Longest we wait for one scroll to settle. */
  maxSettleMs: number;
  /** Overall budget. Exceeding it ends the sweep and the result is marked unverified. */
  maxTotalMs: number;
}

export interface RowSweepResult {
  rows: Map<number, RowRecord>;
  reachedTop: boolean;
  reachedBottom: boolean;
}

export const rowIndexOf = (el: Element): number | null => {
  const raw = el.getAttribute('data-index');
  const n = raw === null || raw.trim() === '' ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

/** The virtual-list row that contains this element, if the page exposes row numbers. */
export const rowOf = (el: Element): Element | null => {
  const row = el.closest('[data-index]');
  return row && rowIndexOf(row) !== null ? row : null;
};

/** The currently mounted rows of the message list (siblings that share the first row's parent). */
export class RowList {
  private parent: Element | null;
  constructor(
    private readonly doc: Document,
    firstRow: Element,
  ) {
    this.parent = firstRow.parentElement;
  }
  rows(): Element[] {
    if (!this.parent?.isConnected) {
      const message = this.doc.querySelector(MESSAGE_SELECTOR);
      const row = message ? rowOf(message) : null;
      if (row?.parentElement) this.parent = row.parentElement;
    }
    return this.parent ? Array.from(this.parent.children).filter((c) => rowIndexOf(c) !== null) : [];
  }
}

const fingerprintOf = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);

function collectRows(elements: Element[], scroller: HTMLElement, into: Map<number, RowRecord>): void {
  const scrollerTop = scroller.getBoundingClientRect().top;
  for (const el of elements) {
    const index = rowIndexOf(el);
    if (index === null) continue;
    const drafts: Draft[] = [];
    let emptyMessages = 0;
    for (const message of topLevelMessages(el)) {
      const result = readMessage(message, null);
      if ('empty' in result) emptyMessages++;
      else drafts.push(result);
    }
    const record: RowRecord = {
      index,
      drafts,
      emptyMessages,
      chars: drafts.reduce((n, d) => n + d.content.length + d.attachments + d.artifacts, 0),
      offset: el.getBoundingClientRect().top - scrollerTop + scroller.scrollTop,
      fingerprint: fingerprintOf(el),
    };
    // A re-render can leave two copies of a row, or a partly rendered one. Keep the fullest.
    const existing = into.get(index);
    if (!existing || record.chars > existing.chars || (record.chars === existing.chars && drafts.length >= existing.drafts.length)) {
      into.set(index, record);
    }
  }
}

const maxIndexOf = (rows: Map<number, RowRecord>) => {
  let max = -1;
  for (const i of rows.keys()) if (i > max) max = i;
  return max;
};

/** Lowest index below the highest collected index that has not been collected (and is not given up on). */
function firstHole(rows: Map<number, RowRecord>, unreachable: Set<number>): number | null {
  const max = maxIndexOf(rows);
  const min = Math.min(...rows.keys());
  for (let i = Number.isFinite(min) ? Math.min(min, 0) : 0; i <= max; i++) {
    if (!rows.has(i) && !unreachable.has(i)) return i;
  }
  return null;
}

interface ScrollSnapshot {
  top: number;
  wasAtBottom: boolean;
  anchor: { fingerprint: string; index: number; offset: number } | null;
}

function captureScroll(scroller: HTMLElement, list: RowList): ScrollSnapshot {
  const scrollerTop = scroller.getBoundingClientRect().top;
  let anchor: ScrollSnapshot['anchor'] = null;
  for (const el of list.rows()) {
    const rect = el.getBoundingClientRect();
    const fingerprint = fingerprintOf(el);
    if (rect.bottom > scrollerTop && fingerprint) {
      anchor = { fingerprint, index: rowIndexOf(el) ?? 0, offset: rect.top - scrollerTop };
      break;
    }
  }
  return {
    top: scroller.scrollTop,
    wasAtBottom: scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2,
    anchor,
  };
}

/**
 * Puts the user back where they were. Pixel offsets are unreliable in a virtual list (row heights
 * are estimated until measured, and older rows may have been added above), so we re-find the row
 * that was at the top of the viewport and align it again.
 */
async function restoreScroll(
  scroller: HTMLElement,
  list: RowList,
  snapshot: ScrollSnapshot,
  rows: Map<number, RowRecord>,
  cfg: SweepConfig,
): Promise<void> {
  const sig = () => `${scroller.scrollHeight}|${list.rows().map((r) => rowIndexOf(r)).join(',')}`;
  if (snapshot.wasAtBottom) {
    for (let i = 0; i < 2; i++) {
      setScrollTop(scroller, scroller.scrollHeight);
      await settle(sig, cfg.settleMs, cfg.maxSettleMs);
    }
    return;
  }
  const { anchor } = snapshot;
  const known = anchor
    ? [...rows.values()]
        .filter((r) => r.fingerprint === anchor.fingerprint)
        .sort((a, b) => Math.abs(a.index - anchor.index) - Math.abs(b.index - anchor.index))[0]
    : undefined;
  setScrollTop(scroller, known && anchor ? Math.max(0, known.offset - anchor.offset) : snapshot.top);
  await settle(sig, cfg.settleMs, cfg.maxSettleMs);
  if (!anchor || !known) return;
  for (let i = 0; i < 3; i++) {
    const row = list
      .rows()
      .filter((el) => fingerprintOf(el) === anchor.fingerprint)
      .sort((a, b) => Math.abs((rowIndexOf(a) ?? 0) - known.index) - Math.abs((rowIndexOf(b) ?? 0) - known.index))[0];
    if (!row) return;
    const delta = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - anchor.offset;
    if (Math.abs(delta) < 2) return;
    setScrollTop(scroller, scroller.scrollTop + delta);
    await settle(sig, cfg.settleMs, cfg.maxSettleMs);
  }
}

/**
 * Reads every row of the virtual list.
 *
 * Phase A - reach and stabilise the top. Older messages may be fetched and prepended, which
 *   renumbers every row, so nothing read before the top is stable is kept.
 * Phase B - sweep down. The step adapts: if a step skips rows (a hole in the numbering) it is
 *   halved and retried, so nothing depends on fixed timing or fixed row heights.
 * Finish - the bottom must be reached twice with the same highest index.
 */
export async function sweepRows(
  scroller: HTMLElement | null,
  list: RowList,
  cfg: SweepConfig,
): Promise<RowSweepResult> {
  const rows = new Map<number, RowRecord>();

  if (!scroller) {
    // Nothing scrolls: the whole list is already mounted.
    const probe = { getBoundingClientRect: () => ({ top: 0 }), scrollTop: 0 } as unknown as HTMLElement;
    collectRows(list.rows(), probe, rows);
    return { rows, reachedTop: true, reachedBottom: true };
  }

  const start = Date.now();
  const expired = () => Date.now() - start > cfg.maxTotalMs;
  const collect = () => collectRows(list.rows(), scroller, rows);
  const signature = () =>
    `${scroller.scrollHeight}|${list
      .rows()
      .map((r) => `${rowIndexOf(r)}:${(r.textContent ?? '').length}`)
      .join(',')}`;
  const minMounted = () => {
    const idx = list.rows().map((r) => rowIndexOf(r) ?? Infinity);
    return idx.length ? Math.min(...idx) : Infinity;
  };
  const snapshot = captureScroll(scroller, list);

  let reachedTop = false;
  let reachedBottom = false;
  try {
    // Phase A
    let last = '';
    let stable = 0;
    for (let i = 0; i < 60 && stable < 2; i++) {
      if (expired()) break;
      setScrollTop(scroller, 0);
      await settle(signature, cfg.settleMs, cfg.maxSettleMs);
      const sig = signature();
      stable = sig === last ? stable + 1 : 0;
      last = sig;
    }
    for (let i = 0; i < 5 && !expired(); i++) {
      if (scroller.scrollTop <= 1 && minMounted() === 0) break;
      setScrollTop(scroller, 0);
      await settle(signature, cfg.settleMs, cfg.maxSettleMs);
    }
    reachedTop = scroller.scrollTop <= 1 && minMounted() === 0;

    // Phase B
    rows.clear();
    collect();
    const baseStep = Math.max(200, Math.floor(scroller.clientHeight * 0.8));
    const maxStep = Math.max(baseStep, scroller.clientHeight * 3);
    const unreachable = new Set<number>();
    let step = baseStep;
    let lastGood = scroller.scrollTop;
    let target = step;
    let maxAtBottom = -1;
    for (let guard = 0; guard < 5000 && !expired(); guard++) {
      setScrollTop(scroller, target);
      await settle(signature, cfg.settleMs, cfg.maxSettleMs);
      collect();
      const at = scroller.scrollTop;

      const hole = firstHole(rows, unreachable);
      if (hole !== null) {
        if (step > MIN_STEP) {
          step = Math.max(MIN_STEP, Math.floor(step / 2));
          target = lastGood + step;
        } else {
          unreachable.add(hole); // even the smallest step never mounted this row
          lastGood = at;
          target = at + step;
        }
        continue;
      }

      lastGood = at;
      if (at + scroller.clientHeight >= scroller.scrollHeight - 2) {
        const maxSeen = maxIndexOf(rows);
        if (maxSeen === maxAtBottom) {
          reachedBottom = true;
          break;
        }
        maxAtBottom = maxSeen; // total size may still be changing: look once more
        target = scroller.scrollHeight;
        continue;
      }
      step = Math.min(maxStep, Math.floor(step * 1.5));
      target = at + step;
    }
  } finally {
    try {
      await restoreScroll(scroller, list, snapshot, rows, cfg);
    } catch {
      setScrollTop(scroller, snapshot.top);
    }
  }
  return { rows, reachedTop, reachedBottom };
}
