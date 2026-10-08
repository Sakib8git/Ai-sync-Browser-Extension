import { detectAdapter } from '../adapters/registry';
import {
  MESSAGE_TYPES,
  type ContentRequest,
  type PageStatus,
  type VisibleTextResponse,
} from '../shared/messages';
import { ExtractionError, type ExtractionResponse } from '../shared/conversation';

/**
 * Content script. It only acts when the popup asks, and it returns data to the popup only.
 * Nothing is stored and nothing is sent over the network.
 */
function getPageStatus(): PageStatus | null {
  const url = new URL(location.href);
  const adapter = detectAdapter(url);
  if (!adapter) return null;
  return {
    providerId: adapter.id,
    providerName: adapter.name,
    isConversation: adapter.isConversationUrl(url),
    canExtract: typeof adapter.extractConversation === 'function',
    title: adapter.getConversationTitle(document),
    url: location.href,
  };
}

let extracting = false;

async function extract(): Promise<ExtractionResponse> {
  if (extracting) {
    return { ok: false, error: { code: 'BUSY', message: 'Already reading this conversation. Please wait.' } };
  }
  const url = new URL(location.href);
  const adapter = detectAdapter(url);
  if (!adapter?.extractConversation) {
    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_PROVIDER',
        message: `Reading ${adapter?.name ?? 'this site'} conversations is not available yet.`,
      },
    };
  }
  extracting = true;
  try {
    return { ok: true, conversation: await adapter.extractConversation(document, url) };
  } catch (error) {
    if (error instanceof ExtractionError) {
      return { ok: false, error: { code: error.code, message: error.message } };
    }
    console.error('[AI Handoff] extraction failed:', error); // never log conversation content
    return {
      ok: false,
      error: {
        code: 'UNKNOWN',
        message: 'Could not read this conversation. The AI website may have changed its interface.',
      },
    };
  } finally {
    extracting = false;
  }
}

/** Manual fallback: whatever text the page currently shows. */
function getVisibleText(): VisibleTextResponse {
  const root = document.querySelector('main') ?? document.body;
  const text = root.innerText?.trim() ?? '';
  return text ? { ok: true, text } : { ok: false, message: 'No visible text found on this page.' };
}

chrome.runtime.onMessage.addListener((message: ContentRequest, _sender, sendResponse) => {
  switch (message?.type) {
    case MESSAGE_TYPES.GET_PAGE_STATUS:
      sendResponse(getPageStatus());
      return false;
    case MESSAGE_TYPES.EXTRACT_CONVERSATION:
      void extract().then(sendResponse);
      return true; // async response
    case MESSAGE_TYPES.GET_VISIBLE_TEXT:
      sendResponse(getVisibleText());
      return false;
    default:
      return false;
  }
});
