import { useCallback, useState } from 'react';
import { MESSAGE_TYPES, type VisibleTextResponse } from '../shared/messages';
import type { ExtractedConversation, ExtractionErrorInfo, ExtractionResponse } from '../shared/conversation';
import { fileName } from './summary';

export type ExtractionState =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'done'; conversation: ExtractedConversation }
  | { phase: 'error'; error: ExtractionErrorInfo };

const CONNECTION_ERROR: ExtractionErrorInfo = {
  code: 'CONNECTION',
  message: 'Could not reach the page. Reload this tab and try again.',
};

/** Holds the extraction result in popup memory only. Nothing is saved anywhere. */
export function useExtraction(tabId: number | null) {
  const [state, setState] = useState<ExtractionState>({ phase: 'idle' });
  const [notice, setNotice] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (tabId === null) return;
    setNotice(null);
    setState({ phase: 'running' });
    try {
      const res = (await chrome.tabs.sendMessage(tabId, {
        type: MESSAGE_TYPES.EXTRACT_CONVERSATION,
      })) as ExtractionResponse | undefined;
      if (!res) throw new Error('No response');
      setState(res.ok ? { phase: 'done', conversation: res.conversation } : { phase: 'error', error: res.error });
    } catch {
      setState({ phase: 'error', error: CONNECTION_ERROR });
    }
  }, [tabId]);

  const copyJson = useCallback(async () => {
    if (state.phase !== 'done') return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(state.conversation, null, 2));
      setNotice('Copied the conversation as JSON.');
    } catch {
      setNotice('Could not use the clipboard. Use Download instead.');
    }
  }, [state]);

  const download = useCallback(() => {
    if (state.phase !== 'done') return;
    const blob = new Blob([JSON.stringify(state.conversation, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName(state.conversation);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice('Saved to your Downloads folder.');
  }, [state]);

  const copyVisibleText = useCallback(async () => {
    if (tabId === null) return;
    try {
      const res = (await chrome.tabs.sendMessage(tabId, {
        type: MESSAGE_TYPES.GET_VISIBLE_TEXT,
      })) as VisibleTextResponse | undefined;
      if (!res?.ok) {
        setNotice(res?.message ?? CONNECTION_ERROR.message);
        return;
      }
      await navigator.clipboard.writeText(res.text);
      setNotice(`Copied ${res.text.length.toLocaleString()} characters of visible page text.`);
    } catch {
      setNotice(CONNECTION_ERROR.message);
    }
  }, [tabId]);

  return { state, notice, run, copyJson, download, copyVisibleText };
}
