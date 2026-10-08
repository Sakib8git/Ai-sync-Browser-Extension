/** Providers the product is designed for. UI-facing metadata only. */
export type ProviderId = 'chatgpt' | 'claude' | 'gemini' | 'generic';

export interface ProviderInfo {
  id: Exclude<ProviderId, 'generic'>;
  name: string;
}

export const PROVIDERS: readonly ProviderInfo[] = [
  { id: 'chatgpt', name: 'ChatGPT' },
  { id: 'claude', name: 'Claude' },
  { id: 'gemini', name: 'Gemini' },
];
