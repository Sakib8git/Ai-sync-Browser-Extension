/**
 * A stand-in for Claude's transcript: a TanStack-style virtual list in jsdom.
 * Rows carry `data-index`, only rows near the viewport are mounted, rows are re-created when they
 * come back, older rows can be fetched and prepended (which renumbers every row), and scroll
 * position is clamped like a browser.
 */
export interface VirtualListOptions {
  /** Full conversation, oldest first. One HTML string per row ('' = a row with no message). */
  rows: string[];
  rowHeight?: number;
  viewport?: number;
  overscan?: number;
  /** Only the last N rows are loaded at first; older ones arrive when the top is reached. */
  initiallyLoaded?: number;
  loadBatch?: number;
  loadLatencyMs?: number;
  /** Chronological row to place at the top of the viewport at start, or 'bottom'. */
  startRow?: number | 'bottom';
  /** Chronological rows that never render (simulates a page that fails to mount them). */
  neverMount?: number[];
  /** Rows rendered twice at once. `true` = identical copy, string = stale copy with this HTML. */
  duplicates?: Record<number, string | true>;
}

export function createVirtualList(doc: Document, o: VirtualListOptions) {
  const rowH = o.rowHeight ?? 250;
  const viewport = o.viewport ?? 500;
  const overscan = o.overscan ?? 1;
  const batch = o.loadBatch ?? 8;
  const latency = o.loadLatencyMs ?? 2;
  let loadedStart = o.initiallyLoaded ? Math.max(0, o.rows.length - o.initiallyLoaded) : 0;
  let pos = 0;
  let pending = false;

  const scroller = doc.createElement('div');
  scroller.style.overflowY = 'auto';
  const sizer = doc.createElement('div');
  scroller.appendChild(sizer);
  doc.querySelector('main')!.appendChild(scroller);

  const loaded = () => o.rows.length - loadedStart;
  const maxScroll = () => Math.max(0, loaded() * rowH - viewport);
  const rect = (top: number) =>
    ({ top, bottom: top + rowH, left: 0, right: 0, width: 0, height: rowH, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

  const mounted = new Map<string, Element>();
  const extras = new Map<string, Element>();

  const make = (local: number, html: string) => {
    const el = doc.createElement('div');
    el.setAttribute('data-index', String(local));
    el.setAttribute('data-test-render-count', '1');
    el.innerHTML = html;
    el.getBoundingClientRect = () => rect(local * rowH - pos);
    return el;
  };

  const render = () => {
    const first = Math.max(0, Math.floor(pos / rowH) - overscan);
    const last = Math.min(loaded() - 1, Math.floor((pos + viewport - 1) / rowH) + overscan);
    const want = new Set<string>();
    const ordered: Element[] = [];
    for (let local = first; local <= last; local++) {
      const chrono = loadedStart + local;
      if (o.neverMount?.includes(chrono)) continue;
      const key = `${local}:${chrono}`;
      want.add(key);
      let el = mounted.get(key);
      if (!el) {
        el = make(local, o.rows[chrono] ?? '');
        mounted.set(key, el);
        const dup = o.duplicates?.[chrono];
        if (dup !== undefined) extras.set(key, make(local, dup === true ? (o.rows[chrono] ?? '') : dup));
      }
      const extra = extras.get(key);
      if (extra) ordered.push(extra);
      ordered.push(el);
    }
    for (const key of [...mounted.keys()]) {
      if (!want.has(key)) {
        mounted.delete(key);
        extras.delete(key);
      }
    }
    sizer.replaceChildren(...ordered);
  };

  const scheduleLoad = () => {
    if (pending || loadedStart === 0) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      const add = Math.min(batch, loadedStart);
      loadedStart -= add;
      mounted.clear();
      extras.clear();
      pos += add * rowH; // browsers keep the viewport anchored when content is added above
      render();
    }, latency);
  };

  Object.defineProperty(scroller, 'scrollHeight', { get: () => loaded() * rowH });
  Object.defineProperty(scroller, 'clientHeight', { get: () => viewport });
  scroller.getBoundingClientRect = () => rect(0);
  Object.defineProperty(scroller, 'scrollTop', {
    get: () => pos,
    set: (v: number) => {
      const next = Math.min(Math.max(0, v), maxScroll());
      if (next === 0) scheduleLoad();
      if (next === pos) return;
      pos = next;
      render();
    },
  });

  pos =
    o.startRow === 'bottom'
      ? maxScroll()
      : Math.min(Math.max(0, ((o.startRow ?? 0) - loadedStart) * rowH), maxScroll());
  render();
  if (pos === 0) scheduleLoad();

  return {
    scroller,
    startPos: pos,
    get pos() {
      return pos;
    },
    isAtBottom: () => pos >= maxScroll(),
  };
}
