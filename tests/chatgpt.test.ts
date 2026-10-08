import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { extractChatGptConversation } from '../src/adapters/chatgpt/extract';
import { ExtractionError } from '../src/shared/conversation';

const URL_OK = new URL('https://chatgpt.com/c/abc-123');
const opts = { loadTimeoutMs: 50, scrollSettleMs: 1 };

const user = (turn: number, id: string, text: string) =>
  `<article data-testid="conversation-turn-${turn}"><div data-message-author-role="user" data-message-id="${id}"><div class="whitespace-pre-wrap">${text}</div></div></article>`;
const assistant = (turn: number, id: string, html: string) =>
  `<article data-testid="conversation-turn-${turn}"><div data-message-author-role="assistant" data-message-id="${id}"><div class="markdown">${html}</div></div></article>`;

const page = (body: string, title = 'Fix login bug') =>
  new JSDOM(`<html><head><title>${title}</title></head><body><main>${body}</main></body></html>`).window.document;

test('extracts roles, order, markdown code and title', async () => {
  const doc = page(
    user(2, 'm1', 'Why does login fail?') +
      assistant(3, 'm2', '<p>Try this:</p><pre><code class="language-js">const a = 1;\n</code></pre>'),
  );
  const c = await extractChatGptConversation(doc, URL_OK, opts);
  assert.equal(c.provider, 'chatgpt');
  assert.equal(c.title, 'Fix login bug');
  assert.equal(c.conversationId, 'abc-123');
  assert.deepEqual(c.messages.map((m) => m.role), ['user', 'assistant']);
  assert.equal(c.messages[0]?.content, 'Why does login fail?');
  assert.equal(c.messages[1]?.content, 'Try this:\n\n```js\nconst a = 1;\n```');
  assert.equal(c.complete, true);
});

test('flags a reply that is still generating', async () => {
  const doc = page(user(2, 'm1', 'Hi') + assistant(3, 'm2', '<p>Partial</p>') + '<button data-testid="stop-button"></button>');
  const c = await extractChatGptConversation(doc, URL_OK, opts);
  assert.equal(c.complete, false);
  assert.ok(c.warnings.some((w) => w.code === 'STILL_GENERATING'));
});

test('flags turns that never loaded', async () => {
  const doc = page(user(2, 'm1', 'A') + assistant(3, 'm2', '<p>B</p>') + assistant(5, 'm4', '<p>D</p>') );
  const c = await extractChatGptConversation(doc, URL_OK, opts);
  assert.equal(c.complete, false);
  assert.ok(c.warnings.some((w) => w.code === 'MISSING_TURNS'));
});

test('flags a conversation that starts mid-way', async () => {
  const doc = page(assistant(3, 'm2', '<p>B</p>') + user(4, 'm3', 'C'));
  const c = await extractChatGptConversation(doc, URL_OK, opts);
  assert.ok(c.warnings.some((w) => w.code === 'STARTS_WITH_ASSISTANT'));
});

test('rejects non-conversation pages and empty pages with clear errors', async () => {
  await assert.rejects(
    extractChatGptConversation(page(''), new URL('https://chatgpt.com/'), opts),
    (e: unknown) => e instanceof ExtractionError && e.code === 'NOT_A_CONVERSATION',
  );
  await assert.rejects(
    extractChatGptConversation(page('<p>loading</p>'), URL_OK, opts),
    (e: unknown) => e instanceof ExtractionError && e.code === 'NO_MESSAGES',
  );
});
