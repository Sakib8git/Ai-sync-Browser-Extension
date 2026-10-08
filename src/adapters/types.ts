import type { ProviderId } from '../shared/providers';
import type { ExtractedConversation } from '../shared/conversation';

/**
 * One adapter per AI website. All knowledge about a site's URLs and DOM lives
 * inside its adapter so a site redesign only ever breaks one folder.
 */
export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly name: string;
  /** Exact hostnames this adapter owns. */
  readonly hostnames: readonly string[];
  /** True when the URL points at an actual conversation (not the home/new-chat page). */
  isConversationUrl(url: URL): boolean;
  /** Best-effort conversation title, or null when unknown. */
  getConversationTitle(doc: Document): string | null;
  /**
   * Reads the whole conversation. Optional: an adapter without it is detection-only.
   * Must throw ExtractionError for expected failures and never return a silently partial result.
   */
  extractConversation?(doc: Document, url: URL): Promise<ExtractedConversation>;
}
