import type { ProviderId } from './providers';

export type MessageRole = 'user' | 'assistant';

export interface ExtractedMessage {
  /** Zero-based position in the conversation. */
  index: number;
  /** Provider's own message id when available. */
  id: string | null;
  role: MessageRole;
  /** Markdown text. Code blocks are preserved as fenced blocks with their language. */
  content: string;
}

export type WarningCode =
  | 'STILL_GENERATING'
  | 'MISSING_TURNS'
  | 'STARTS_WITH_ASSISTANT'
  | 'IMAGES_NOT_CAPTURED'
  | 'ORDER_UNVERIFIED'
  | 'UNLOADED_MESSAGES'
  | 'EMPTY_ROWS_SKIPPED'
  | 'ARTIFACTS_NOT_CAPTURED'
  | 'BODY_FALLBACK'
  | 'EARLIEST_NOT_VERIFIED'
  | 'LATEST_NOT_VERIFIED'
  | 'ROWS_MISSING'
  | 'DUPLICATES_COLLAPSED';

export interface ExtractionWarning {
  code: WarningCode;
  /** "warning" means the result may be incomplete. "info" is a note only. */
  severity: 'warning' | 'info';
  message: string;
}

/** How the result was gathered and what was verified. Lets the user (and later phases) judge trust. */
export interface ExtractionDiagnostics {
  /** "row-index": verified against the page's own row numbers. "dom-order": page order only. */
  strategy: 'row-index' | 'dom-order';
  reachedTop: boolean;
  reachedBottom: boolean;
  rowsRead?: number;
  firstRow?: number;
  lastRow?: number;
  missingRows?: number;
  /** Page-order providers (Gemini): how the start of the conversation was established. */
  startEvidence?: 'top-stable' | 'not-scrollable' | 'not-verified';
  /** Page-order providers: how many times the top was revisited while older messages loaded. */
  loadRounds?: number;
  messagesRead?: number;
  duplicatesCollapsed?: number;
  scrollerFound?: boolean;
  elapsedMs?: number;
}

export interface ExtractedConversation {
  schemaVersion: 1;
  provider: ProviderId;
  conversationId: string | null;
  title: string | null;
  url: string;
  extractedAt: string;
  messages: ExtractedMessage[];
  warnings: ExtractionWarning[];
  /** False whenever any warning-level issue was found. Never assume completeness without checking. */
  complete: boolean;
  diagnostics?: ExtractionDiagnostics;
}

export type ExtractionErrorCode =
  | 'UNSUPPORTED_PROVIDER'
  | 'NOT_A_CONVERSATION'
  | 'NO_MESSAGES'
  | 'BUSY'
  | 'CONNECTION'
  | 'UNKNOWN';

export interface ExtractionErrorInfo {
  code: ExtractionErrorCode;
  message: string;
}

export class ExtractionError extends Error {
  readonly code: ExtractionErrorCode;
  constructor(code: ExtractionErrorCode, message: string) {
    super(message);
    this.name = 'ExtractionError';
    this.code = code;
  }
}

export type ExtractionResponse =
  | { ok: true; conversation: ExtractedConversation }
  | { ok: false; error: ExtractionErrorInfo };
