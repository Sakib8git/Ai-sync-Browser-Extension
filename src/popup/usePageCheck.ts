import { useCallback, useEffect, useState } from 'react';
import { detectAdapter } from '../adapters/registry';
import { MESSAGE_TYPES, type PageStatus } from '../shared/messages';
import type { ProviderId } from '../shared/providers';

export interface PageCheck {
  loading: boolean;
  tabId: number | null;
  providerId: ProviderId | null;
  providerName: string | null;
  isConversation: boolean;
  /** Content script answered on this tab. */
  connected: boolean;
  /** This provider's adapter can read conversations. */
  canExtract: boolean;
  title: string | null;
}

const INITIAL: PageCheck = {
  loading: true,
  tabId: null,
  providerId: null,
  providerName: null,
  isConversation: false,
  connected: false,
  canExtract: false,
  title: null,
};

/** Inspects the active tab: URL-based detection first, then a handshake with the content script. */
export function usePageCheck() {
  const [check, setCheck] = useState<PageCheck>(INITIAL);

  const run = useCallback(async () => {
    setCheck((c) => ({ ...c, loading: true }));
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    let adapter = null;
    let url: URL | null = null;
    try {
      url = tab?.url ? new URL(tab.url) : null;
      adapter = url ? detectAdapter(url) : null;
    } catch {
      adapter = null;
    }

    if (!tab?.id || !url || !adapter) {
      setCheck({ ...INITIAL, loading: false });
      return;
    }

    let connected = false;
    let canExtract = false;
    let title = adapter.getConversationTitle({ title: tab.title ?? '' } as Document);
    try {
      const status = (await chrome.tabs.sendMessage(tab.id, {
        type: MESSAGE_TYPES.GET_PAGE_STATUS,
      })) as PageStatus | null;
      if (status) {
        connected = true;
        canExtract = status.canExtract;
        title = status.title;
      }
    } catch {
      connected = false; // No content script: tab was open before install, or page still loading.
    }

    setCheck({
      loading: false,
      tabId: tab.id,
      providerId: adapter.id,
      providerName: adapter.name,
      isConversation: adapter.isConversationUrl(url),
      connected,
      canExtract,
      title,
    });
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  return { check, refresh: run };
}
