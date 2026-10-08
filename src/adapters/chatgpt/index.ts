import type { ProviderAdapter } from '../types';
import { cleanTitle } from '../title';
import { extractChatGptConversation } from './extract';

export const chatgptAdapter: ProviderAdapter = {
  id: 'chatgpt',
  name: 'ChatGPT',
  hostnames: ['chatgpt.com', 'chat.openai.com'],
  // Conversations live at /c/<id>, or /g/<gpt>/c/<id> inside a custom GPT.
  isConversationUrl: (url) => /\/c\/[\w-]+/.test(url.pathname),
  getConversationTitle: (doc) => cleanTitle(doc.title, ['ChatGPT']),
  extractConversation: (doc, url) => extractChatGptConversation(doc, url),
};
