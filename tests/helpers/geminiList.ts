/**
 * A stand-in for Gemini's transcript in jsdom: an <infinite-scroller> holding one
 * .conversation-container per question/answer pair, with older turns fetched and prepended when
 * the top is reached. Optionally unmounts far-away turns and re-creates them (virtualization).
 */
export interface GeminiTurn {
  /** One entry per line the user typed (each becomes a <p class="query-text-line">). */
  user: string[];
  /** Inner HTML of the rendered answer (.markdown). */
  model: string;
}

export interface GeminiListOptions {
  turns: GeminiTurn[];
  turnHeight?: number;
  viewport?: number;
  /** Only the last N turns are loaded at first; older ones arrive when the top is reached. */
  initiallyLoaded?: number;
  loadBatch?: number;
  loadLatencyMs?: number;
  /** Older turns load only when the top is arrived at, not while the list already sits there. */
  loadOnlyOnArrival?: boolean;
  /** Chronological turn to place at the top of the viewport at start, or 'bottom'. */
  startTurn?: number | 'bottom';
  /** Unmount turns outside the viewport (+overscan) and re-create them when they return. */
  unmount?: boolean;
  overscan?: number;
  /** Chronological turns rendered twice in a row: `true` = identical copy, string = stale answer HTML. */
  duplicates?: Record<number, string | true>;
}

export const turnHtml = (turn: GeminiTurn, modelOverride?: string) =>
  `<user-query><div class="user-query-container"><h2 class="cdk-visually-hidden">You said</h2><div class="query-text">${turn.user
    .map((l) => `<p class="query-text-line">${l}</p>`)
    .join('')}</div></div></user-query>` +
  `<model-response><response-container><div class="response-content"><message-content><div class="markdown markdown-main-panel">${
    modelOverride ?? turn.model
  }</div></message-content></div></response-container></model-response>`;

export function createGeminiList(doc: Document, o: GeminiListOptions) {
  const H = o.turnHeight ?? 400;
  const viewport = o.viewport ?? 600;
  const overscan = o.overscan ?? 1;
  const batch = o.loadBatch ?? 6;
  const latency = o.loadLatencyMs ?? 5;
  let loadedStart = o.initiallyLoaded ? Math.max(0, o.turns.length - o.initiallyLoaded) : 0;
  let pos = 0;
  let pending = false;

  const scroller = doc.createElement('infinite-scroller');
  scroller.className = 'chat-history';
  scroller.setAttribute('data-test-id', 'chat-history-container');
  scroller.style.overflowY = 'auto';
  doc.querySelector('main')!.appendChild(scroller);

  const loaded = () => o.turns.length - loadedStart;
  const maxScroll = () => Math.max(0, loaded() * H - viewport);
  const rect = (top: number, height = H) =>
    ({ top, bottom: top + height, left: 0, right: 0, width: 0, height, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

  const make = (local: number, html: string) => {
    const el = doc.createElement('div');
    el.className = 'conversation-container';
    el.innerHTML = html;
    el.getBoundingClientRect = () => rect(local * H - pos);
    const user = el.querySelector('user-query');
    const model = el.querySelector('model-response');
    if (user) user.getBoundingClientRect = () => rect(local * H - pos, H / 2);
    if (model) model.getBoundingClientRect = () => rect(local * H - pos + H / 2, H / 2);
    return el;
  };

  const mounted = new Map<string, Element>();
  const extras = new Map<string, Element>();

  const render = () => {
    const first = o.unmount ? Math.max(0, Math.floor(pos / H) - overscan) : 0;
    const last = o.unmount ? Math.min(loaded() - 1, Math.floor((pos + viewport - 1) / H) + overscan) : loaded() - 1;
    const want = new Set<string>();
    const ordered: Element[] = [];
    for (let local = first; local <= last; local++) {
      const chrono = loadedStart + local;
      const key = `${local}:${chrono}`;
      want.add(key);
      let el = mounted.get(key);
      if (!el) {
        const turn = o.turns[chrono]!;
        el = make(local, turnHtml(turn));
        mounted.set(key, el);
        const dup = o.duplicates?.[chrono];
        if (dup !== undefined) extras.set(key, make(local, turnHtml(turn, dup === true ? turn.model : dup)));
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
    scroller.replaceChildren(...ordered);
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
      pos += add * H; // browsers keep the viewport anchored when content is added above
      render();
    }, latency);
  };

  Object.defineProperty(scroller, 'scrollHeight', { get: () => loaded() * H });
  Object.defineProperty(scroller, 'clientHeight', { get: () => viewport });
  scroller.getBoundingClientRect = () => rect(0, viewport);
  Object.defineProperty(scroller, 'scrollTop', {
    get: () => pos,
    set: (v: number) => {
      const next = Math.min(Math.max(0, v), maxScroll());
      const arrived = next === 0 && pos > 0;
      if (o.loadOnlyOnArrival ? arrived : next === 0) scheduleLoad();
      if (next === pos) return;
      pos = next;
      render();
    },
  });

  pos =
    o.startTurn === 'bottom'
      ? maxScroll()
      : Math.min(Math.max(0, ((o.startTurn ?? 0) - loadedStart) * H), maxScroll());
  render();
  if (pos === 0 && !o.loadOnlyOnArrival) scheduleLoad();

  return {
    scroller,
    startPos: pos,
    get pos() {
      return pos;
    },
    isAtBottom: () => pos >= maxScroll(),
    loadedTurns: () => loaded(),
  };
}
