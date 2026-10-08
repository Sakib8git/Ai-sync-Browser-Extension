import type { ExtractionState } from './useExtraction';
import { summarize } from './summary';

interface Props {
  state: ExtractionState;
  providerName: string | null;
  notice: string | null;
  onRetry: () => void;
  onCopyJson: () => void;
  onDownload: () => void;
  onCopyVisible: () => void;
}

export function ResultPanel({ state, providerName, notice, onRetry, onCopyJson, onDownload, onCopyVisible }: Props) {
  if (state.phase === 'idle' || state.phase === 'running') return null;

  if (state.phase === 'error') {
    return (
      <section className="panel panel-error" role="alert">
        <h2>Could not read this conversation</h2>
        <p>{state.error.message}</p>
        <div className="actions">
          <button className="secondary" onClick={onRetry}>Retry</button>
          <button className="secondary" onClick={onCopyVisible}>Copy visible text</button>
        </div>
        {notice && <p className="notice" role="status">{notice}</p>}
      </section>
    );
  }

  const c = state.conversation;
  const s = summarize(c);
  const warnings = c.warnings.filter((w) => w.severity === 'warning');
  const notes = c.warnings.filter((w) => w.severity === 'info');

  return (
    <section className={`panel ${c.complete ? 'panel-ok' : 'panel-warn'}`}>
      <div className="panel-head">
        <h2>{c.title ?? 'Untitled conversation'}</h2>
        <span className={`badge ${c.complete ? 'badge-ok' : 'badge-warn'}`}>
          {c.complete ? 'Complete' : 'Check warnings'}
        </span>
      </div>
      <p className="stats">
        {c.messages.length} messages: {s.user} from you, {s.assistant} from {providerName ?? 'the AI'}.{' '}
        {s.chars.toLocaleString()} characters, {s.codeBlocks} code {s.codeBlocks === 1 ? 'block' : 'blocks'} kept.
      </p>

      {c.complete && c.diagnostics?.strategy === 'row-index' && (
        <p className="verified">
          Verified against {providerName ?? 'the AI'}’s own row numbers: rows {c.diagnostics.firstRow}–
          {c.diagnostics.lastRow} all read, from the first message to the latest.
        </p>
      )}

      {warnings.length > 0 && (
        <ul className="warnlist">
          {warnings.map((w) => <li key={w.code}>{w.message}</li>)}
        </ul>
      )}
      {notes.length > 0 && (
        <ul className="notelist">
          {notes.map((w) => <li key={w.code}>{w.message}</li>)}
        </ul>
      )}

      <div className="actions">
        <button className="secondary" onClick={onCopyJson}>Copy JSON</button>
        <button className="secondary" onClick={onDownload}>Download JSON</button>
        <button className="secondary" onClick={onRetry}>Read again</button>
      </div>
      {notice && <p className="notice" role="status">{notice}</p>}

      <details>
        <summary>Preview data</summary>
        <pre>{JSON.stringify(c, null, 2).slice(0, 2500)}</pre>
      </details>
      <p className="where">Held in this popup only. It is not saved or sent anywhere, and closing the popup discards it.</p>
    </section>
  );
}
