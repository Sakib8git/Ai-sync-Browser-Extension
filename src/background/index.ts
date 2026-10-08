import { MESSAGE_TYPES, type BackgroundRequest } from '../shared/messages';

/**
 * Phase 1: the service worker is intentionally thin. It is here so later phases
 * (opening target AI tabs, handoff transfer, storage coordination) have a home.
 * MV3 service workers are killed when idle, so never keep state in module variables.
 */
chrome.runtime.onInstalled.addListener((details) => {
  console.info('[AI Handoff] installed/updated:', details.reason);
});

chrome.runtime.onMessage.addListener((message: BackgroundRequest, _sender, sendResponse) => {
  if (message?.type === MESSAGE_TYPES.PING) {
    sendResponse({ ok: true });
  }
  return false; // synchronous response only
});
