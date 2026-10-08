import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { domToMarkdown } from '../src/adapters/markdown';

const md = (html: string) => {
  const doc = new JSDOM(`<body><div id="r">${html}</div></body>`).window.document;
  return domToMarkdown(doc.getElementById('r')!);
};

test('code blocks keep language, blank lines and indentation; UI chrome is dropped', () => {
  const out = md(
    '<pre><div><div>python<button>Copy code</button></div><div><code class="hljs language-python">def a():\n\n    return 1\n</code></div></div></pre>',
  );
  assert.equal(out, '```python\ndef a():\n\n    return 1\n```');
});

test('inline formatting and nested lists', () => {
  const out = md('<p>Use <strong>this</strong> and <code>x</code></p><ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul>');
  assert.equal(out, 'Use **this** and `x`\n\n- one\n- two\n  - nested');
});

test('tables become markdown tables', () => {
  const out = md('<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>');
  assert.equal(out, '| A | B |\n| --- | --- |\n| 1 | 2 |');
});

test('math keeps its TeX source', () => {
  const out = md(
    '<p>Value <span class="katex"><span class="katex-mathml"><math><semantics><mrow></mrow><annotation encoding="application/x-tex">x^2</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">x2</span></span> here</p>',
  );
  assert.equal(out, 'Value $x^2$ here');
});

test('code inside a list item is re-indented', () => {
  const out = md('<ol><li>Install<pre><code class="language-bash">npm i</code></pre></li></ol>');
  assert.equal(out, '1. Install\n   ```bash\n   npm i\n   ```');
});
