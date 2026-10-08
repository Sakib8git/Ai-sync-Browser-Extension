import type { ProviderId } from './providers';

/** Every runtime message uses a namespaced type so future phases can extend this safely. */
export const MESSAGE_TYPES = {
  GET_PAGE_STATUS: 'AI_HANDOFF/GET_PAGE_STATUS',
  EXTRACT_CONVERSATION: 'AI_HANDOFF/EXTRACT_CONVERSATION',
  GET_VISIBLE_TEXT: 'AI_HANDOFF/GET_VISIBLE_TEXT',
  PING: 'AI_HANDOFF/PING',
} as const;

export type ContentRequest =
  | { type: typeof MESSAGE_TYPES.GET_PAGE_STATUS }
  | { type: typeof MESSAGE_TYPES.EXTRACT_CONVERSATION }
  | { type: typeof MESSAGE_TYPES.GET_VISIBLE_TEXT };

export type BackgroundRequest = { type: typeof MESSAGE_TYPES.PING };

/** What the content script reports about the page it is running on. */
export interface PageStatus {
  providerId: ProviderId;
  providerName: string;
  isConversation: boolean;
  /** True when this provider's adapter can read conversations. */
  canExtract: boolean;
  title: string | null;
  url: string;
}

export type VisibleTextResponse = { ok: true; text: string } | { ok: false; message: string };
