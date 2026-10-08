import type { ProviderAdapter } from '../types';

/**
 * Placeholder for unsupported sites. It is never matched by hostname; it exists so
 * a future "copy visible text" fallback has a home that fits the same interface.
 */
export const genericAdapter: ProviderAdapter = {
  id: 'generic',
  name: 'Generic page',
  hostnames: [],
  isConversationUrl: () => false,
  getConversationTitle: (doc) => doc.title.trim() || null,
};
