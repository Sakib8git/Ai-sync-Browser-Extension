import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectAdapter } from '../src/adapters/registry';

test('routes each site to its own adapter', () => {
  assert.equal(detectAdapter(new URL('https://chatgpt.com/c/abc'))?.id, 'chatgpt');
  assert.equal(detectAdapter(new URL('https://claude.ai/chat/abc'))?.id, 'claude');
  assert.equal(detectAdapter(new URL('https://gemini.google.com/app/abc'))?.id, 'gemini');
  assert.equal(detectAdapter(new URL('https://example.com/')), null);
});

test('conversation URLs are recognised per provider', () => {
  const claude = detectAdapter(new URL('https://claude.ai/'))!;
  assert.equal(claude.isConversationUrl(new URL('https://claude.ai/chat/1b2c-3d')), true);
  assert.equal(claude.isConversationUrl(new URL('https://claude.ai/new')), false);
  assert.equal(claude.isConversationUrl(new URL('https://claude.ai/chats')), false);
  const gpt = detectAdapter(new URL('https://chatgpt.com/'))!;
  assert.equal(gpt.isConversationUrl(new URL('https://chatgpt.com/c/abc-1')), true);
  assert.equal(gpt.isConversationUrl(new URL('https://chatgpt.com/')), false);
});

test('every supported provider can extract', () => {
  for (const host of ['chatgpt.com', 'claude.ai', 'gemini.google.com']) {
    assert.equal(typeof detectAdapter(new URL(`https://${host}/`))?.extractConversation, 'function', host);
  }
});

test('Gemini conversation URLs, including /u/<n> and Gems', () => {
  const gemini = detectAdapter(new URL('https://gemini.google.com/'))!;
  const ok = (p: string) => gemini.isConversationUrl(new URL(`https://gemini.google.com${p}`));
  assert.equal(ok('/app/1a2b3c4d5e'), true);
  assert.equal(ok('/u/1/app/1a2b3c4d5e'), true);
  assert.equal(ok('/gem/abc123/1a2b3c4d5e'), true);
  assert.equal(ok('/app'), false);
  assert.equal(ok('/gem/abc123'), false);
});
