import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { extractClaudeConversation } from '../src/adapters/claude/extract';
import { createVirtualList, type VirtualListOptions } from './helpers/virtualList';

const URL_OK = new URL('https://claude.ai/chat/1b2c3d4e-0000-4000-8000-abcdefabcdef');
const opts = { loadTimeoutMs: 50, scrollSettleMs: 8, maxSettleMs: 400 };

const u = (t: string) => `<div data-testid="user-message"><p class="whitespace-pre-wrap">${t}</p></div>`;
const a = (t: string) => `<div class="font-claude-response"><div class="standard-markdown"><p>${t}</p></div></div>`;

/** Q1, A1, Q2, A2, ... (rows alternate user / assistant, oldest first). */
const conversation = (turns: number) => Array.from({ length: turns * 2 }, (_, i) => (i % 2 === 0 ? u(`Q${i / 2 + 1}`) : a(`A${(i - 1) / 2 + 1}`)));
const expected = (turns: number) => Array.from({ length: turns * 2 }, (_, i) => (i % 2 === 0 ? `Q${i / 2 + 1}` : `A${(i - 1) / 2 + 1}`));

const setup = (o: VirtualListOptions) => {
  const doc = new JSDOM('<html><head><title>Sync notes - Claude</title></head><body><main></main></body></html>').window.document;
  const list = createVirtualList(doc, o);
  return { doc, list };
};

test('long conversation with lazily loaded older messages is read in full and in order', async () => {
  const { doc, list } = setup({ rows: conversation(20), initiallyLoaded: 6, loadBatch: 8, startRow: 'bottom' });
  const c = await extractClaudeConversation(doc, URL_OK, opts);
  assert.deepEqual(c.messages.map((m) => m.content), expected(20));
  assert.deepEqual(c.messages.map((m) => m.index), [...Array(40).keys()]);
  assert.equal(c.complete, true);
  assert.deepEqual(c.warnings, []);
  assert.equal(c.diagnostics?.strategy, 'row-index');
  assert.equal(c.diagnostics?.firstRow, 0);
  assert.equal(c.diagnostics?.lastRow, 39);
  assert.equal(list.isAtBottom(), true, 'user was at the bottom and is returned there');
});

test('rows removed and re-created while scrolling: no loss, no duplicates, scroll restored', async () => {
  const { doc, list } = setup({ rows: conversation(15), overscan: 0, startRow: 12 });
  const before = list.startPos;
  const c = await extractClaudeConversation(doc, URL_OK, opts);
  assert.deepEqual(c.messages.map((m) => m.content), expected(15));
  assert.equal(new Set(c.messages.map((m) => m.content)).size, 30);
  assert.equal(c.complete, true);
  assert.equal(list.pos, before, 'scroll position restored');
});

test('a page that first renders an assistant message is not mistaken for the start', async () => {
  const { doc } = setup({ rows: conversation(6), overscan: 0, startRow: 5 });
  assert.match(doc.querySelector('[data-index]')?.textContent ?? '', /A3/, 'fixture starts mid-conversation on an assistant row');
  const c = await extractClaudeConversation(doc, URL_OK, opts);
  assert.equal(c.messages[0]?.content, 'Q1');
  assert.equal(c.messages[0]?.role, 'user');
  assert.deepEqual(c.messages.map((m) => m.content), expected(6));
  assert.equal(c.complete, true);
  assert.ok(!c.warnings.some((w) => w.code === 'STARTS_WITH_ASSISTANT'));
});

test('duplicate renders of the same row collapse to one message, keeping the fullest copy', async () => {
  const rows = conversation(5);
  const { doc } = setup({
    rows,
    duplicates: { 3: a('A'), 4: true }, // row 3: stale partial copy first; row 4: identical copy
    overscan: 2,
  });
  const c = await extractClaudeConversation(doc, URL_OK, opts);
  assert.deepEqual(c.messages.map((m) => m.content), expected(5));
  assert.equal(c.complete, true);
});

test('chronological order is correct after the sweep, with sequential indexes', async () => {
  const { doc } = setup({ rows: conversation(13), overscan: 1, viewport: 400, rowHeight: 300, startRow: 9 });
  const c = await extractClaudeConversation(doc, URL_OK, opts);
  assert.deepEqual(c.messages.map((m) => m.content), expected(13));
  assert.deepEqual(c.messages.map((m) => m.role), Array.from({ length: 26 }, (_, i) => (i % 2 === 0 ? 'user' : 'assistant')));
  assert.equal(c.diagnostics?.lastRow, 25);
});

test('a row that never mounts is reported, never hidden, and the result is incomplete', async () => {
  const { doc } = setup({ rows: conversation(10), neverMount: [7] });
  const c = await extractClaudeConversation(doc, URL_OK, opts);
  assert.equal(c.messages.length, 19);
  assert.equal(c.complete, false);
  assert.ok(c.warnings.some((w) => w.code === 'ROWS_MISSING' && w.severity === 'warning'));
});

test('if the first row can never be reached, the start is reported as unverified', async () => {
  const { doc } = setup({ rows: conversation(10), neverMount: [0], startRow: 'bottom' });
  const c = await extractClaudeConversation(doc, URL_OK, opts);
  assert.equal(c.complete, false);
  assert.ok(c.warnings.some((w) => w.code === 'EARLIEST_NOT_VERIFIED'));
  assert.ok(c.messages.length >= 18, 'everything that could be read is still returned');
});

test('running out of time ends the sweep as incomplete, not as a quiet partial result', async () => {
  const { doc } = setup({ rows: conversation(30), startRow: 'bottom' });
  const c = await extractClaudeConversation(doc, URL_OK, { ...opts, maxTotalMs: 1 });
  assert.equal(c.complete, false);
  assert.ok(c.warnings.some((w) => ['EARLIEST_NOT_VERIFIED', 'LATEST_NOT_VERIFIED', 'ROWS_MISSING'].includes(w.code)));
});

test('empty status rows inside the list are skipped, counted, and do not break verification', async () => {
  const rows = conversation(6);
  rows.splice(5, 0, '');
  const { doc } = setup({ rows });
  const c = await extractClaudeConversation(doc, URL_OK, opts);
  assert.equal(c.messages.length, 12);
  assert.equal(c.complete, true);
  assert.ok(c.warnings.some((w) => w.code === 'EMPTY_ROWS_SKIPPED' && w.severity === 'info'));
});

test('code, artifacts, Bangla text and user whitespace still come through the row-index path', async () => {
  const rows = [
    u('আমার কোডটা ঠিক করো\n  indented\n\nlast'),
    `<div class="font-claude-response"><div class="standard-markdown"><p>Here:</p>` +
      `<div class="group/copy"><div>python<button>Copy</button></div><pre><code class="language-python">x = 1\n\nprint(x)\n</code></pre></div>` +
      `<div data-testid="artifact-block-container">Widget</div></div></div>`,
  ];
  const { doc } = setup({ rows });
  const c = await extractClaudeConversation(doc, URL_OK, opts);
  assert.equal(c.messages[0]?.content, 'আমার কোডটা ঠিক করো\n  indented\n\nlast');
  assert.equal(c.messages[1]?.content, 'Here:\n\n```python\nx = 1\n\nprint(x)\n```\n\nWidget');
  assert.equal(c.complete, true);
  assert.ok(c.warnings.some((w) => w.code === 'ARTIFACTS_NOT_CAPTURED'));
});
