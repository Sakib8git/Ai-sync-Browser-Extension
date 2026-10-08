import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { extractClaudeConversation } from '../src/adapters/claude/extract';
import { ExtractionError } from '../src/shared/conversation';

const URL_OK = new URL('https://claude.ai/chat/1b2c3d4e-0000-4000-8000-abcdefabcdef');
const opts = { loadTimeoutMs: 50, scrollSettleMs: 1 };

const user = (html: string, extra = '') =>
  `<div data-test-render-count="1">${extra}<div data-testid="user-message">${html}</div></div>`;
const assistant = (html: string, attrs = '') =>
  `<div data-test-render-count="1"><div class="font-claude-response" ${attrs}><div class="standard-markdown">${html}</div></div></div>`;

const page = (body: string, title = 'Fix login bug - Claude') =>
  new JSDOM(`<html><head><title>${title}</title></head><body><main>${body}</main></body></html>`).window.document;

const codeBlock = (label: string, code: string, cls = '') =>
  `<div class="relative group/copy"><div class="text-text-500">${label}<button>Copy</button></div><pre class="code-block__code"><code class="${cls}">${code}</code></pre></div>`;

test('extracts id, title, url, roles and order', async () => {
  const doc = page(user('<p class="whitespace-pre-wrap">Why does login fail?</p>') + assistant('<p>Check the token.</p>'));
  const c = await extractClaudeConversation(doc, URL_OK, opts);
  assert.equal(c.provider, 'claude');
  assert.equal(c.conversationId, '1b2c3d4e-0000-4000-8000-abcdefabcdef');
  assert.equal(c.title, 'Fix login bug');
  assert.equal(c.url, URL_OK.href);
  assert.deepEqual(c.messages.map((m) => m.role), ['user', 'assistant']);
  assert.deepEqual(c.messages.map((m) => m.index), [0, 1]);
  assert.equal(c.messages[0]?.content, 'Why does login fail?');
  assert.equal(c.messages[1]?.content, 'Check the token.');
  assert.equal(c.complete, true);
  assert.deepEqual(c.warnings, []);
});

test('code blocks come out as clean fences; header chrome is removed', async () => {
  const doc = page(
    user('<p>Show code</p>') +
      assistant(
        '<p>Two files:</p>' +
          codeBlock('python', 'def a():\n\n    return 1\n', 'language-python') +
          codeBlock('bash', 'npm i && npm test\n', ''),
      ),
  );
  const c = await extractClaudeConversation(doc, URL_OK, opts);
  assert.equal(
    c.messages[1]?.content,
    'Two files:\n\n```python\ndef a():\n\n    return 1\n```\n\n```bash\nnpm i && npm test\n```',
  );
});

test('lists, tables and links are kept as Markdown', async () => {
  const doc = page(
    user('<p>Go</p>') +
      assistant(
        '<h2>Plan</h2><p>See <a href="https://example.com/docs">the docs</a>.</p><ol><li>One</li><li>Two<ul><li>Nested</li></ul></li></ol>' +
          '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>',
      ),
  );
  const c = await extractClaudeConversation(doc, URL_OK, opts);
  assert.equal(
    c.messages[1]?.content,
    '## Plan\n\nSee [the docs](https://example.com/docs).\n\n1. One\n2. Two\n   - Nested\n\n| A | B |\n| --- | --- |\n| 1 | 2 |',
  );
});

test('user text keeps line breaks and indentation exactly', async () => {
  const doc = page(user('<p class="whitespace-pre-wrap">line1\n  indented\n\nline3</p>') + assistant('<p>ok</p>'));
  const c = await extractClaudeConversation(doc, URL_OK, opts);
  assert.equal(c.messages[0]?.content, 'line1\n  indented\n\nline3');
});

test('Bangla and Banglish text survive', async () => {
  const doc = page(user('<p>আমার কোডটা ঠিক করো, ekhon kaj korche na</p>') + assistant('<p>অবশ্যই। চলুন দেখি।</p>'));
  const c = await extractClaudeConversation(doc, URL_OK, opts);
  assert.equal(c.messages[0]?.content, 'আমার কোডটা ঠিক করো, ekhon kaj korche na');
  assert.equal(c.messages[1]?.content, 'অবশ্যই। চলুন দেখি।');
});

test('flags a reply that is still streaming', async () => {
  const doc = page(user('<p>Hi</p>') + assistant('<p>Partial</p>', 'data-is-streaming="true"'));
  const c = await extractClaudeConversation(doc, URL_OK, opts);
  assert.equal(c.complete, false);
  assert.ok(c.warnings.some((w) => w.code === 'STILL_GENERATING'));
});

test('flags a conversation that starts mid-way', async () => {
  const doc = page(assistant('<p>B</p>') + user('<p>C</p>'));
  const c = await extractClaudeConversation(doc, URL_OK, opts);
  assert.equal(c.complete, false);
  assert.ok(c.warnings.some((w) => w.code === 'STARTS_WITH_ASSISTANT'));
});

test('empty status rows are skipped but reported, not hidden', async () => {
  const doc = page(
    user('<p>Q</p>') +
      '<div data-test-render-count="1"><div class="font-claude-response"></div></div>' +
      assistant('<p>A</p>'),
  );
  const c = await extractClaudeConversation(doc, URL_OK, opts);
  assert.equal(c.messages.length, 2);
  const w = c.warnings.find((x) => x.code === 'EMPTY_ROWS_SKIPPED');
  assert.ok(w && w.severity === 'info');
  assert.equal(c.complete, true);
});

test('attachment-only messages are kept with a placeholder and flagged', async () => {
  const doc = page(
    user('', '<div data-testid="file-thumbnail"></div>') + assistant('<p>I see the file.</p>'),
  );
  const c = await extractClaudeConversation(doc, URL_OK, opts);
  assert.equal(c.messages.length, 2);
  assert.match(c.messages[0]?.content ?? '', /only an attachment or artifact/);
  assert.ok(c.warnings.some((w) => w.code === 'IMAGES_NOT_CAPTURED'));
});

test('artifact cards are flagged; chat text is kept', async () => {
  const doc = page(
    user('<p>Make a page</p>') +
      assistant('<p>Here it is.</p><div data-testid="artifact-block-container">Landing page</div>'),
  );
  const c = await extractClaudeConversation(doc, URL_OK, opts);
  assert.equal(c.messages[1]?.content, 'Here it is.\n\nLanding page');
  assert.ok(c.warnings.some((w) => w.code === 'ARTIFACTS_NOT_CAPTURED'));
});

test('replies without the usual text container fall back and say so', async () => {
  const doc = page(user('<p>Q</p>') + '<div data-test-render-count="1"><div class="font-claude-response"><p>Hello</p></div></div>');
  const c = await extractClaudeConversation(doc, URL_OK, opts);
  assert.equal(c.messages[1]?.content, 'Hello');
  assert.ok(c.warnings.some((w) => w.code === 'BODY_FALLBACK'));
});

test('title falls back to the chat header when the tab title is generic', async () => {
  const doc = page(
    '<button data-testid="chat-title-button">My project chat</button>' + user('<p>Q</p>') + assistant('<p>A</p>'),
    'Claude',
  );
  const c = await extractClaudeConversation(doc, URL_OK, opts);
  assert.equal(c.title, 'My project chat');
});

test('messages unloaded during scrolling are kept, ordered, de-duplicated and flagged', async () => {
  const dom = new JSDOM('<html><head><title>T - Claude</title></head><body><main><div id="s" style="overflow-y:auto"></div></main></body></html>');
  const doc = dom.window.document;
  const s = doc.getElementById('s')!;
  const messages: Record<string, string> = {
    m1: user('<p>one</p>'),
    m2: assistant('<p>two</p>'),
    m3: user('<p>three</p>'),
    m4: assistant('<p>four</p>'),
  };
  const mount = (keys: string[]) => {
    s.innerHTML = keys.map((k) => messages[k]).join(''); // fresh elements each time, like a virtual list
  };
  let pos = 800;
  Object.defineProperty(s, 'scrollHeight', { value: 1000 });
  Object.defineProperty(s, 'clientHeight', { value: 500 });
  Object.defineProperty(s, 'scrollTop', {
    get: () => pos,
    set: (v: number) => {
      if (v === pos) return;
      pos = v;
      mount(v === 0 ? ['m1', 'm2'] : v < 800 ? ['m2', 'm3'] : ['m3', 'm4']);
    },
  });
  mount(['m3', 'm4']);

  const c = await extractClaudeConversation(doc, URL_OK, opts);
  assert.deepEqual(c.messages.map((m) => m.content), ['one', 'two', 'three', 'four']);
  assert.equal(c.complete, false);
  assert.ok(c.warnings.some((w) => w.code === 'UNLOADED_MESSAGES'));
  assert.equal(pos, 800, 'scroll position restored');
});

test('errors are clear for non-conversation pages and empty pages', async () => {
  await assert.rejects(
    extractClaudeConversation(page(''), new URL('https://claude.ai/new'), opts),
    (e: unknown) => e instanceof ExtractionError && e.code === 'NOT_A_CONVERSATION',
  );
  await assert.rejects(
    extractClaudeConversation(page('<p>loading</p>'), URL_OK, opts),
    (e: unknown) => e instanceof ExtractionError && e.code === 'NO_MESSAGES',
  );
});
