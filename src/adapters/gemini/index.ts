import type { ProviderAdapter } from '../types';
import { cleanTitle } from '../title';
import { extractGeminiConversation } from './extract';

export const geminiAdapter: ProviderAdapter = {
  id: 'gemini',
  name: 'Gemini',
  hostnames: ['gemini.google.com'],
  // Conversations live at /app/<id> (optionally prefixed with /u/<n>) or /gem/<gem>/<id>.
  // /app alone (new chat) and /gem/<gem> alone do not match.
  isConversationUrl: (url) => /\/app\/[\w-]+/.test(url.pathname) || /\/gem\/[\w-]+\/[\w-]+/.test(url.pathname),
  getConversationTitle: (doc) => cleanTitle(doc.title, ['Google Gemini', 'Gemini']),
  extractConversation: (doc, url) => extractGeminiConversation(doc, url),
};
