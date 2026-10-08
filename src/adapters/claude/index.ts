import type { ProviderAdapter } from '../types';
import { cleanTitle } from '../title';
import { extractClaudeConversation } from './extract';

export const claudeAdapter: ProviderAdapter = {
  id: 'claude',
  name: 'Claude',
  hostnames: ['claude.ai'],
  // Conversations live at /chat/<uuid>. The list page (/chats) and new chat (/new) do not match.
  isConversationUrl: (url) => /\/chat\/[\w-]+/.test(url.pathname),
  getConversationTitle: (doc) => cleanTitle(doc.title, ['Claude']),
  extractConversation: (doc, url) => extractClaudeConversation(doc, url),
};
