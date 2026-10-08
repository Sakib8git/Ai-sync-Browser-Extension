/**
 * Helpers for providers whose messages have no stable row numbers, so order comes from the page.
 */
const DOCUMENT_POSITION_FOLLOWING = 4;

export interface Ordered<D> {
  items: D[];
  /** True when some messages were removed from the page while scrolling, so order is estimated. */
  estimated: boolean;
}

/**
 * Orders collected messages. Messages still on the page are authoritative and sort by document
 * position. Messages the page removed while we scrolled are kept (never silently dropped) unless
 * they are an earlier copy of a re-rendered message; if any remain, everything is ordered by the
 * scroll offset recorded when it was seen and `estimated` is set so callers must warn.
 */
export function resolvePageOrder<D extends { offset: number }>(
  entries: [Element, D][],
  keyOf: (d: D) => string,
): Ordered<D> {
  const liveKeys = new Set(entries.filter(([el]) => el.isConnected).map(([, d]) => keyOf(d)));
  const keptDetached = new Set<string>();
  const kept = entries.filter(([el, d]) => {
    if (el.isConnected) return true;
    const key = keyOf(d);
    if (liveKeys.has(key) || keptDetached.has(key)) return false;
    keptDetached.add(key);
    return true;
  });
  const estimated = kept.some(([el]) => !el.isConnected);
  kept.sort(
    estimated
      ? (a, b) => a[1].offset - b[1].offset
      : (a, b) => (a[0] === b[0] ? 0 : a[0].compareDocumentPosition(b[0]) & DOCUMENT_POSITION_FOLLOWING ? -1 : 1),
  );
  return { items: kept.map(([, d]) => d), estimated };
}

interface Message {
  role: string;
  content: string;
}

/**
 * Same message, or a partial render of it. Only AI replies can be partial (they are rendered
 * progressively); text the user typed is either identical or a different message, so "Q" and
 * "Q2" must never be treated as copies of each other.
 */
const compatible = (a: Message, b: Message) =>
  a.role === b.role &&
  a.content.length > 0 &&
  b.content.length > 0 &&
  (a.content === b.content ||
    (a.role === 'assistant' && (a.content.startsWith(b.content) || b.content.startsWith(a.content))));

/**
 * A page can leave two copies of the same message side by side (a stale partial render next to
 * the full one). Collapses neighbouring copies, keeping the fuller text. Two cases:
 *   - the same message twice in a row, and
 *   - the same whole turn twice in a row (question, answer, question, answer).
 * Returns how many messages were removed so the caller can report it.
 */
export function collapseRenderDuplicates<D extends Message>(items: D[]): { items: D[]; removed: number } {
  let list = [...items];
  let removed = 0;
  const fuller = (a: D, b: D) => (b.content.length > a.content.length ? b : a);

  // pairs first, so a duplicated turn is not mistaken for two separate repeats
  for (let i = 0; i + 3 < list.length; ) {
    const [a, b, c, d] = [list[i], list[i + 1], list[i + 2], list[i + 3]] as [D, D, D, D];
    if (a.role !== b.role && compatible(a, c) && compatible(b, d)) {
      list.splice(i, 4, fuller(a, c), fuller(b, d));
      removed += 2;
    } else i++;
  }
  const out: D[] = [];
  for (const item of list) {
    const prev = out[out.length - 1];
    if (prev && compatible(prev, item)) {
      out[out.length - 1] = fuller(prev, item);
      removed++;
    } else out.push(item);
  }
  list = out;
  return { items: list, removed };
}
