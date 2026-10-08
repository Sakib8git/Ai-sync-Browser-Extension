export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Polls until check() is true or the timeout passes. Returns whether it became true. */
export async function waitFor(check: () => boolean, timeoutMs: number, intervalMs = 150): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (check()) return true;
    await sleep(intervalMs);
  }
  return check();
}

/**
 * Finds the element that scrolls the message list: the nearest scrollable ancestor of `from`,
 * else the page itself. Returns null when nothing scrolls (everything is already visible).
 */
export function findScroller(doc: Document, from: Element): HTMLElement | null {
  const view = doc.defaultView;
  let el: HTMLElement | null = from.parentElement;
  while (el && el !== doc.body && el !== doc.documentElement) {
    const overflowY = view?.getComputedStyle(el).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
      return el;
    }
    el = el.parentElement;
  }
  const root = doc.scrollingElement as HTMLElement | null;
  return root && root.scrollHeight > root.clientHeight + 1 ? root : null;
}

/**
 * Sets the scroll position immediately. `behavior: "instant"` overrides CSS `scroll-behavior: smooth`,
 * which would otherwise animate and leave the list mid-scroll when we read it.
 */
export function setScrollTop(el: HTMLElement, top: number): void {
  if (typeof el.scrollTo === 'function') el.scrollTo({ top, behavior: 'instant' });
  else el.scrollTop = top;
}

/**
 * Waits until `signature()` stops changing for `quietMs` (or `maxMs` passes). Used after scrolling,
 * because virtual lists mount rows asynchronously and heavy Markdown can render progressively.
 */
export async function settle(signature: () => string, quietMs: number, maxMs: number): Promise<void> {
  const poll = Math.max(1, Math.floor(quietMs / 4));
  const start = Date.now();
  let last = signature();
  let quietSince = Date.now();
  while (Date.now() - start < maxMs) {
    await sleep(poll);
    const sig = signature();
    if (sig !== last) {
      last = sig;
      quietSince = Date.now();
    } else if (Date.now() - quietSince >= quietMs) {
      return;
    }
  }
}

export interface SweepReach {
  reachedTop: boolean;
  reachedBottom: boolean;
}

/**
 * Scrolls to the top until older content stops loading, then sweeps down calling `collect()`
 * at every step. The user's scroll position is always restored. Reports whether the top and the
 * bottom were actually reached so callers never have to assume it.
 */
export async function sweepScroller(scroller: HTMLElement, settleMs: number, collect: () => void): Promise<SweepReach> {
  const original = scroller.scrollTop;
  let reachedTop = false;
  let reachedBottom = false;
  try {
    let lastHeight = -1;
    let stable = 0;
    for (let i = 0; i < 40 && stable < 2; i++) {
      setScrollTop(scroller, 0);
      await sleep(settleMs * 3);
      stable = scroller.scrollHeight === lastHeight ? stable + 1 : 0;
      lastHeight = scroller.scrollHeight;
    }
    reachedTop = scroller.scrollTop <= 1;
    const step = Math.max(200, Math.floor(scroller.clientHeight * 0.8));
    for (let pos = 0, guard = 0; guard < 500; guard++, pos += step) {
      setScrollTop(scroller, pos);
      await sleep(settleMs);
      collect();
      if (pos + scroller.clientHeight >= scroller.scrollHeight - 2) break;
    }
    await sleep(settleMs);
    collect();
    reachedBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
  } finally {
    setScrollTop(scroller, original);
  }
  return { reachedTop, reachedBottom };
}

/**
 * Resolves once `root` has had no DOM changes for `quietMs`, or after `maxMs` at the latest
 * (a streaming reply never goes quiet, so the cap keeps reads bounded).
 */
export function waitForQuiet(root: Node, doc: Document, quietMs: number, maxMs: number): Promise<void> {
  const Observer = doc.defaultView?.MutationObserver;
  if (!Observer) return sleep(quietMs);
  return new Promise<void>((resolve) => {
    let quietTimer: ReturnType<typeof setTimeout>;
    const finish = () => {
      observer.disconnect();
      clearTimeout(quietTimer);
      clearTimeout(capTimer);
      resolve();
    };
    const observer = new Observer(() => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(finish, quietMs);
    });
    const capTimer = setTimeout(finish, maxMs);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    quietTimer = setTimeout(finish, quietMs);
  });
}

export interface LoadOlderOptions {
  /** Changes whenever the mounted content changes (message count, text length, ...). */
  signature: () => string;
  /** Called after every visit to the top so nothing seen there is lost if the page later unmounts it. */
  collect?: () => void;
  settleMs: number;
  maxSettleMs: number;
  /** The top must stay unchanged this long before we believe nothing older exists. */
  patienceMs: number;
  /** Hard cap on the whole wait. */
  maxTotalMs: number;
}

export interface LoadOlderResult {
  reachedTop: boolean;
  timedOut: boolean;
  rounds: number;
}

/**
 * Keeps returning to the top until older messages stop arriving. "Height stopped changing for a
 * moment" is not enough: older messages load asynchronously, so the top must stay unchanged for a
 * patience window. Each round also nudges away from the top and back, because lazy loaders
 * usually fire when the top is *arrived at*, not while the list already sits there.
 */
export async function loadOlder(scroller: HTMLElement, o: LoadOlderOptions): Promise<LoadOlderResult> {
  const start = Date.now();
  let last = '';
  let lastChange = start;
  let rounds = 0;
  for (;;) {
    if (rounds > 0) {
      setScrollTop(scroller, Math.min(25, Math.max(0, scroller.scrollHeight - scroller.clientHeight)));
      await sleep(Math.max(1, Math.floor(o.settleMs / 2)));
    }
    setScrollTop(scroller, 0);
    await settle(o.signature, o.settleMs, o.maxSettleMs);
    o.collect?.();
    rounds++;
    const sig = `${scroller.scrollHeight}|${o.signature()}`;
    if (sig !== last) {
      last = sig;
      lastChange = Date.now();
    }
    if (scroller.scrollTop <= 1 && Date.now() - lastChange >= o.patienceMs) {
      return { reachedTop: true, timedOut: false, rounds };
    }
    if (Date.now() - start > o.maxTotalMs) return { reachedTop: false, timedOut: true, rounds };
    await sleep(Math.max(1, Math.floor(o.settleMs / 2)));
  }
}

export interface ViewAnchor {
  el: Element | null;
  key: string;
  /** Distance from the top of the scroller to the anchor element when captured. */
  offset: number;
  wasAtBottom: boolean;
  fromBottom: number;
}

/** Remembers what the reader is looking at: the first message that is at least partly visible. */
export function captureViewAnchor(
  scroller: HTMLElement,
  items: () => Element[],
  keyOf: (el: Element) => string,
): ViewAnchor {
  const top = scroller.getBoundingClientRect().top;
  let el: Element | null = null;
  let offset = 0;
  for (const item of items()) {
    const rect = item.getBoundingClientRect();
    if (rect.bottom > top) {
      el = item;
      offset = rect.top - top;
      break;
    }
  }
  return {
    el,
    key: el ? keyOf(el) : '',
    offset,
    wasAtBottom: scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2,
    fromBottom: scroller.scrollHeight - scroller.scrollTop,
  };
}

/**
 * Puts the reader back. Older content arrives above them and rows may be re-created, so a pixel
 * offset would point at different content. Bottom readers return to the bottom; others have the
 * remembered message re-found and re-aligned.
 */
export async function restoreViewAnchor(
  scroller: HTMLElement,
  anchor: ViewAnchor,
  items: () => Element[],
  keyOf: (el: Element) => string,
  signature: () => string,
  quietMs: number,
  maxMs: number,
): Promise<void> {
  const sig = () => `${scroller.scrollHeight}|${signature()}`;
  if (anchor.wasAtBottom) {
    for (let i = 0; i < 2; i++) {
      setScrollTop(scroller, scroller.scrollHeight);
      await settle(sig, quietMs, maxMs);
    }
    return;
  }
  setScrollTop(scroller, Math.max(0, scroller.scrollHeight - anchor.fromBottom));
  await settle(sig, quietMs, maxMs);
  if (!anchor.el) return;
  for (let i = 0; i < 3; i++) {
    const target = anchor.el.isConnected ? anchor.el : items().find((e) => keyOf(e) === anchor.key);
    if (!target) return;
    const delta = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - anchor.offset;
    if (Math.abs(delta) < 2) return;
    setScrollTop(scroller, scroller.scrollTop + delta);
    await settle(sig, quietMs, maxMs);
  }
}
