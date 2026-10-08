import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { extractGeminiConversation } from '../src/adapters/gemini/extract';
import { createGeminiList, type GeminiListOptions, type GeminiTurn } from './helpers/geminiList';

const URL_OK = new URL('https://gemini.google.com/app/3f9a1c2b4d5e6f70');
const opts = { loadTimeoutMs: 50, scrollSettleMs: 5, maxSettleMs: 400, topPatienceMs: 120 };

const turns = (n: number): GeminiTurn[] =>
  Array.from({ length: n }, (_, i) => ({ user: [`Q${i + 1}`], model: `<p>A${i + 1}</p>` }));
const expected = (n: number) => Array.from({ length: n }, (_, i) => [`Q${i + 1}`, `A${i + 1}`]).flat();

const setup = (o: GeminiListOptions) => {
  const doc = new JSDOM('<html><head><title>AI sync - Google Gemini</title></head><body><main></main></body></html>').window.document;
  return { doc, list: createGeminiList(doc, o) };
};

test('short conversation that fits on screen is read as-is', async () => {
  const { doc } = setup({ turns: turns(1), viewport: 2000 });
  const c = await extractGeminiConversation(doc, URL_OK, opts);
  assert.deepEqual(c.messages.map((m) => m.content), expected(1));
  assert.equal(c.complete, true);
});

test('long conversation with lazily loaded older turns is read in full and in order', async () => {
  const { doc, list } = setup({ turns: turns(25), initiallyLoaded: 6, loadBatch: 8, startTurn: 'bottom' });
  const c = await extractGeminiConversation(doc, URL_OK, opts);
  assert.deepEqual(c.messages.map((m) => m.content), expected(25));
  assert.deepEqual(c.messages.map((m) => m.index), [...Array(50).keys()]);
  assert.equal(c.complete, true);
  assert.deepEqual(c.warnings, []);
  assert.equal(c.diagnostics?.startEvidence, 'top-stable');
  assert.equal(c.diagnostics?.reachedTop, true);
  assert.equal(c.diagnostics?.reachedBottom, true);
  assert.equal(c.diagnostics?.messagesRead, 50);
  assert.ok((c.diagnostics?.loadRounds ?? 0) >= 3, 'revisited the top while older turns arrived');
  assert.equal(list.loadedTurns(), 25);
  assert.equal(list.isAtBottom(), true, 'reader at the bottom is returned there');
});

test('older turns that only load when the top is re-arrived at are still found', async () => {
  const { doc } = setup({ turns: turns(14), initiallyLoaded: 4, loadBatch: 5, loadOnlyOnArrival: true, startTurn: 'bottom' });
  const c = await extractGeminiConversation(doc, URL_OK, opts);
  assert.deepEqual(c.messages.map((m) => m.content), expected(14));
  assert.equal(c.complete, true);
});

test('reader position in the middle is restored after older turns were loaded above', async () => {
  const { doc, list } = setup({ turns: turns(20), initiallyLoaded: 8, loadBatch: 6, startTurn: 16 });
  const firstVisibleBefore = doc.querySelector('user-query')?.textContent ?? '';
  const c = await extractGeminiConversation(doc, URL_OK, opts);
  assert.deepEqual(c.messages.map((m) => m.content), expected(20));
  const visibleTop = Math.floor(list.pos / 400);
  const loadedStart = 20 - list.loadedTurns();
  assert.equal(loadedStart, 0);
  assert.match(firstVisibleBefore, /Q1[2-9]|Q2/, 'fixture started deep in the conversation');
  assert.equal(visibleTop, 16, 'the same turn is at the top of the viewport again');
});

test('turns unmounted and re-created while scrolling: nothing lost or duplicated, but order is flagged', async () => {
  const { doc } = setup({ turns: turns(12), unmount: true, overscan: 0, startTurn: 'bottom' });
  const c = await extractGeminiConversation(doc, URL_OK, opts);
  assert.deepEqual(c.messages.map((m) => m.content), expected(12));
  assert.equal(new Set(c.messages.map((m) => m.content)).size, 24);
  assert.equal(c.complete, false);
  assert.ok(c.warnings.some((w) => w.code === 'UNLOADED_MESSAGES' && w.severity === 'warning'));
});

test('duplicate renders in a long lazy-loaded conversation collapse and keep order', async () => {
  const { doc } = setup({
    turns: turns(10),
    initiallyLoaded: 4,
    loadBatch: 4,
    duplicates: { 3: '<p>A</p>', 7: true },
    startTurn: 'bottom',
  });
  const c = await extractGeminiConversation(doc, URL_OK, opts);
  assert.deepEqual(c.messages.map((m) => m.content), expected(10));
  assert.ok(c.warnings.some((w) => w.code === 'DUPLICATES_COLLAPSED'));
  assert.equal(c.complete, true);
});

test('chronological order is correct after the full sweep', async () => {
  const { doc } = setup({ turns: turns(18), initiallyLoaded: 5, loadBatch: 5, viewport: 500, turnHeight: 350, startTurn: 'bottom' });
  const c = await extractGeminiConversation(doc, URL_OK, opts);
  assert.deepEqual(c.messages.map((m) => m.role), Array.from({ length: 36 }, (_, i) => (i % 2 === 0 ? 'user' : 'assistant')));
  assert.deepEqual(c.messages.map((m) => m.content), expected(18));
});

test('running out of time while older turns are still arriving is reported, not hidden', async () => {
  const { doc } = setup({ turns: turns(30), initiallyLoaded: 4, loadBatch: 2, loadLatencyMs: 30, startTurn: 'bottom' });
  const c = await extractGeminiConversation(doc, URL_OK, { ...opts, maxTotalMs: 60 });
  assert.equal(c.complete, false);
  assert.ok(c.warnings.some((w) => w.code === 'EARLIEST_NOT_VERIFIED' && w.severity === 'warning'));
  assert.equal(c.diagnostics?.startEvidence, 'not-verified');
  assert.ok(c.messages.length >= 8, 'everything that was read is still returned');
});
