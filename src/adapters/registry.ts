import type { ProviderAdapter } from './types';
import { chatgptAdapter } from './chatgpt';
import { claudeAdapter } from './claude';
import { geminiAdapter } from './gemini';

const ADAPTERS: readonly ProviderAdapter[] = [chatgptAdapter, claudeAdapter, geminiAdapter];

/** Returns the adapter that owns this URL, or null if the site is not supported. */
export function detectAdapter(url: URL): ProviderAdapter | null {
  return ADAPTERS.find((a) => a.hostnames.includes(url.hostname)) ?? null;
}

export function detectAdapterFromString(raw: string | undefined): ProviderAdapter | null {
  if (!raw) return null;
  try {
    return detectAdapter(new URL(raw));
  } catch {
    return null;
  }
}
