import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { extractGeminiConversation } from '../src/adapters/gemini/extract';
import { ExtractionError } from '../src/shared/conversation';

const URL_OK = new URL('https://gemini.google.com/app/3f9a1c2b4d5e6f70');
const opts = { loadTimeoutMs: 50, scrollSettleMs: 3, maxSettleMs: 50, topPatienceMs: 20 };

const lines = (...l: string[]) => l.map((t) => `<p class="query-text-line">${t}</p>`).join('');
const userQuery = (inner: string, extra = '') =>
  `<user-query>${extra}<div class="user-query-container"><h2 class="cdk-visually-hidden">You said</h2><div class="query-text">${inner}</div></div></user-query>`;
const modelResponse = (html: string, extra = '') =>
  `<model-response><response-container><div class="response-content">${extra}<message-content><div class="markdown markdown-main-panel">${html}</div></message-content></div></response-container></model-response>`;
const turn = (user: string, model: string) => `<div class="conversation-container">${user}${model}</div>`;
const page = (body: string, title = 'Fix login bug - Google Gemini') =>
  new JSDOM(
    `<html><head><title>${title}</title></head><body><main><infinite-scroller class="chat-history" data-test-id="chat-history-container">${body}</infinite-scroller></main></body></html>`,
  ).window.document;

const codeBlock = (label: string, code: string, cls = '') =>
  `<code-block><div class="code-block-decoration"><span>${label}</span><button>Copy code</button></div><pre><code class="code-container formatted ${cls}">${code}</code></pre></code-block>`;

test('extracts id, title, url, roles and order', async () => {
  const doc = page(
    turn(userQuery(lines('Why does login fail?')), modelResponse('<p>Check the token.</p>')) +
      turn(userQuery(lines('Thanks')), modelResponse('<p>Welcome.</p>')),
  );
  const c = await extractGeminiConversation(doc, URL_OK, opts);
  assert.equal(c.provider, 'gemini');
  assert.equal(c.conversationId, '3f9a1c2b4d5e6f70');
  assert.equal(c.title, 'Fix login bug');
  assert.equal(c.url, URL_OK.href);
  assert.deepEqual(c.messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert.deepEqual(c.messages.map((m) => m.index), [0, 1, 2, 3]);
  assert.deepEqual(c.messages.map((m) => m.content), ['Why does login fail?', 'Check the token.', 'Thanks', 'Welcome.']);
  assert.equal(c.complete, true);
  assert.deepEqual(c.warnings, []);
  assert.equal(c.diagnostics?.startEvidence, 'not-scrollable');
});

test('conversation id from /u/<n>/app and Gem URLs', async () => {
  const doc = page(turn(userQuery(lines('Hi')), modelResponse('<p>Hello</p>')));
  const a = await extractGeminiConversation(doc, new URL('https://gemini.google.com/u/1/app/abc123'), opts);
  assert.equal(a.conversationId, 'abc123');
  const b = await extractGeminiConversation(doc, new URL('https://gemini.google.com/gem/gemid9/chat456'), opts);
  assert.equal(b.conversationId, 'chat456');
});

test('code blocks: language from the label, header chrome removed, whitespace kept', async () => {
  const doc = page(
    turn(
      userQuery(lines('Show code')),
      modelResponse(
        '<p>Two files:</p>' +
          codeBlock('Python', 'def a():\n\n    return 1\n') +
          codeBlock('Bash', 'npm i &amp;&amp; npm test\n') +
          codeBlock('JavaScript', 'const x = 1;\n', 'language-javascript'),
      ),
    ),
  );
  const c = await extractGeminiConversation(doc, URL_OK, opts);
  assert.equal(
    c.messages[1]?.content,
    'Two files:\n\n```python\ndef a():\n\n    return 1\n```\n\n```bash\nnpm i && npm test\n```\n\n```javascript\nconst x = 1;\n```',
  );
  assert.ok(!c.messages[1]?.content.includes('Copy code'));
});

test('headings, nested lists, tables, links and math', async () => {
  const doc = page(
    turn(
      userQuery(lines('Go')),
      modelResponse(
        '<h2>Plan</h2><p>See <a href="https://example.com/docs">the docs</a>.</p>' +
          '<ol><li>One</li><li>Two<ul><li>Nested</li></ul></li></ol>' +
          '<table-block><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table><div class="table-footer"><button>Export to Sheets</button></div></table-block>' +
          '<p>Area <span class="math-inline" data-math="\\pi r^2"><span>πr2</span></span></p>' +
          '<div class="math-block" data-math="E = mc^2"><span>E=mc2</span></div>',
      ),
    ),
  );
  const c = await extractGeminiConversation(doc, URL_OK, opts);
  assert.equal(
    c.messages[1]?.content,
    '## Plan\n\nSee [the docs](https://example.com/docs).\n\n1. One\n2. Two\n   - Nested\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nArea $\\pi r^2$\n\n$$\nE = mc^2\n$$',
  );
});

test('Bangla and Banglish text survive', async () => {
  const doc = page(
    turn(userQuery(lines('আমার কোডটা ঠিক করো', 'ekhon kaj korche na')), modelResponse('<p>অবশ্যই। চলুন দেখি।</p>')),
  );
  const c = await extractGeminiConversation(doc, URL_OK, opts);
  assert.equal(c.messages[0]?.content, 'আমার কোডটা ঠিক করো\nekhon kaj korche na');
  assert.equal(c.messages[1]?.content, 'অবশ্যই। চলুন দেখি।');
});

test('user text keeps line breaks, blank lines and indentation', async () => {
  const doc = page(turn(userQuery(lines('line1', '  indented', '&nbsp;', 'line3')), modelResponse('<p>ok</p>')));
  const c = await extractGeminiConversation(doc, URL_OK, opts);
  assert.equal(c.messages[0]?.content, 'line1\n  indented\n \nline3');
});

test('interface text, hidden labels, thinking and source footnotes do not leak', async () => {
  const doc = page(
    turn(
      userQuery(lines('Q')),
      modelResponse(
        '<p>Answer<sup data-turn-source-index="1">1</sup>.</p><sources-list>Sources</sources-list><message-actions><button>Good response</button></message-actions>',
        '<thinking-overlay>Show thinking: secret reasoning</thinking-overlay>',
      ),
    ),
  );
  const c = await extractGeminiConversation(doc, URL_OK, opts);
  assert.equal(c.messages[0]?.content, 'Q');
  assert.equal(c.messages[1]?.content, 'Answer.');
});

test('flags a reply that is still being written', async () => {
  const doc = page(turn(userQuery(lines('Hi')), modelResponse('<p>Partial</p>')) + '<button aria-label="Stop response"></button>');
  const c = await extractGeminiConversation(doc, URL_OK, opts);
  assert.equal(c.complete, false);
  assert.ok(c.warnings.some((w) => w.code === 'STILL_GENERATING'));
});

test('flags a conversation whose first message is from Gemini', async () => {
  const doc = page(turn('', modelResponse('<p>B</p>')) + turn(userQuery(lines('C')), modelResponse('<p>D</p>')));
  const c = await extractGeminiConversation(doc, URL_OK, opts);
  assert.equal(c.complete, false);
  assert.ok(c.warnings.some((w) => w.code === 'STARTS_WITH_ASSISTANT' && w.severity === 'warning'));
});

test('empty status rows are skipped but reported', async () => {
  const doc = page(
    turn(userQuery(lines('Q')), '<model-response></model-response>') + turn(userQuery(lines('Q2')), modelResponse('<p>A</p>')),
  );
  const c = await extractGeminiConversation(doc, URL_OK, opts);
  assert.deepEqual(c.messages.map((m) => m.content), ['Q', 'Q2', 'A']);
  assert.ok(c.warnings.some((w) => w.code === 'EMPTY_ROWS_SKIPPED' && w.severity === 'info'));
});

test('attachments, generated images and Canvas are kept as text and flagged, never hidden', async () => {
  const doc = page(
    turn(userQuery('', '<uploader-file-preview></uploader-file-preview>'), modelResponse('<p>I see the file.</p>')) +
      turn(
        userQuery(lines('Make a logo')),
        modelResponse('<p>Here it is.</p><generated-image></generated-image><immersive-entry-chip>Logo plan</immersive-entry-chip>'),
      ),
  );
  const c = await extractGeminiConversation(doc, URL_OK, opts);
  assert.equal(c.messages.length, 4);
  assert.match(c.messages[0]?.content ?? '', /only an attachment or generated content/);
  assert.ok(c.warnings.some((w) => w.code === 'IMAGES_NOT_CAPTURED' && w.severity === 'info'));
  assert.ok(c.warnings.some((w) => w.code === 'ARTIFACTS_NOT_CAPTURED' && w.severity === 'info'));
  assert.equal(c.complete, true);
});

test('replies without the usual text container fall back and say so', async () => {
  const doc = page(
    turn(userQuery(lines('Q')), '<model-response><response-container><div class="response-content"><message-content><p>Hello</p></message-content></div></response-container></model-response>'),
  );
  const c = await extractGeminiConversation(doc, URL_OK, opts);
  assert.equal(c.messages[1]?.content, 'Hello');
  assert.ok(c.warnings.some((w) => w.code === 'BODY_FALLBACK'));
});

test('title falls back to the highlighted sidebar chat when the tab title is generic', async () => {
  const doc = page(
    '<div class="selected"><span class="conversation-title">Trip planning</span></div>' +
      turn(userQuery(lines('Q')), modelResponse('<p>A</p>')),
    'Google Gemini',
  );
  const c = await extractGeminiConversation(doc, URL_OK, opts);
  assert.equal(c.title, 'Trip planning');
});

test('a stale partial copy rendered next to the full one is merged, with a note', async () => {
  const full = turn(userQuery(lines('Question 4')), modelResponse('<p>Answer 4 in full</p>'));
  const stale = turn(userQuery(lines('Question 4')), modelResponse('<p>Answer 4</p>'));
  const doc = page(turn(userQuery(lines('Q1')), modelResponse('<p>A1</p>')) + stale + full);
  const c = await extractGeminiConversation(doc, URL_OK, opts);
  assert.deepEqual(c.messages.map((m) => m.content), ['Q1', 'A1', 'Question 4', 'Answer 4 in full']);
  assert.ok(c.warnings.some((w) => w.code === 'DUPLICATES_COLLAPSED' && w.severity === 'info'));
  assert.equal(c.complete, true);
});

test('repeated identical questions with different answers are NOT merged', async () => {
  const doc = page(
    turn(userQuery(lines('continue')), modelResponse('<p>Part 2</p>')) + turn(userQuery(lines('continue')), modelResponse('<p>Part 3</p>')),
  );
  const c = await extractGeminiConversation(doc, URL_OK, opts);
  assert.deepEqual(c.messages.map((m) => m.content), ['continue', 'Part 2', 'continue', 'Part 3']);
  assert.ok(!c.warnings.some((w) => w.code === 'DUPLICATES_COLLAPSED'));
});

test('errors are clear for non-conversation pages and empty pages', async () => {
  await assert.rejects(
    extractGeminiConversation(page(''), new URL('https://gemini.google.com/app'), opts),
    (e: unknown) => e instanceof ExtractionError && e.code === 'NOT_A_CONVERSATION',
  );
  await assert.rejects(
    extractGeminiConversation(page('<p>loading</p>'), URL_OK, opts),
    (e: unknown) => e instanceof ExtractionError && e.code === 'NO_MESSAGES',
  );
});

test('different user messages that share a prefix are never merged', async () => {
  const doc = page(
    turn(userQuery(lines('Q')), modelResponse('<p>A</p>')) + turn(userQuery(lines('Q2')), modelResponse('<p>A2</p>')),
  );
  const c = await extractGeminiConversation(doc, URL_OK, opts);
  assert.deepEqual(c.messages.map((m) => m.content), ['Q', 'A', 'Q2', 'A2']);
  assert.ok(!c.warnings.some((w) => w.code === 'DUPLICATES_COLLAPSED'));
});
