import { PROVIDERS } from '../shared/providers';
import { usePageCheck } from './usePageCheck';
import { useExtraction } from './useExtraction';
import { ResultPanel } from './ResultPanel';

type RowState = 'ok' | 'warn' | 'idle';

function StatusRow(props: { state: RowState; label: string; detail: string }) {
  return (
    <li className={`row row-${props.state}`}>
      <span className="row-mark" aria-hidden="true">
        {props.state === 'ok' ? '✓' : props.state === 'warn' ? '!' : ''}
      </span>
      <div>
        <div className="row-label">{props.label}</div>
        <div className="row-detail">{props.detail}</div>
      </div>
    </li>
  );
}

export function App() {
  const { check, refresh } = usePageCheck();
  const extraction = useExtraction(check.tabId);
  const supported = check.providerId !== null;
  const running = extraction.state.phase === 'running';
  const canRead = supported && check.isConversation && check.connected && check.canExtract && !running;

  const siteRow: { state: RowState; detail: string } = check.loading
    ? { state: 'idle', detail: 'Checking this tab…' }
    : supported
      ? { state: 'ok', detail: `${check.providerName} is supported.` }
      : { state: 'idle', detail: 'Open ChatGPT, Claude or Gemini in this tab.' };

  const convoRow: { state: RowState; detail: string } = !supported
    ? { state: 'idle', detail: 'Waiting for a supported site.' }
    : check.isConversation
      ? { state: 'ok', detail: check.title ?? 'Conversation open (no title yet).' }
      : { state: 'warn', detail: 'Open a conversation to read it.' };

  const pageRow: { state: RowState; detail: string } = !supported
    ? { state: 'idle', detail: 'Not needed on this site.' }
    : check.connected
      ? { state: 'ok', detail: 'AI Handoff is active on this page.' }
      : { state: 'warn', detail: 'Reload this tab so the extension can connect.' };

  let hint: string;
  if (running) hint = 'Reading the conversation. The page scrolls briefly, then returns to where you were.';
  else if (supported && check.connected && !check.canExtract)
    hint = `Reading ${check.providerName} conversations arrives in a later phase.`;
  else if (canRead) hint = 'The page scrolls briefly to load every message. Nothing is saved or sent.';
  else hint = 'Open a supported conversation to enable reading.';

  return (
    <main className="shell">
      <header className="head">
        <h1>AI Handoff</h1>
        <button className="link" onClick={() => void refresh()} disabled={check.loading || running}>
          Check again
        </button>
      </header>

      {/* The memorable element: the baton pass. Left = where you are, right = where you go next. */}
      <section className="pass" aria-label="Handoff direction">
        <div className={`node ${supported ? 'node-live' : ''}`}>
          <span className="node-dot" />
          <span className="node-name">{supported ? check.providerName : 'No AI detected'}</span>
          <span className="node-sub">Current</span>
        </div>
        <div className="track" aria-hidden="true" />
        <div className="node node-next">
          <span className="node-dot" />
          <span className="node-name">Next AI</span>
          <span className="node-sub">Choose later</span>
        </div>
      </section>

      <ul className="rows">
        <StatusRow state={siteRow.state} label="AI website" detail={siteRow.detail} />
        <StatusRow state={convoRow.state} label="Conversation" detail={convoRow.detail} />
        <StatusRow state={pageRow.state} label="Extension connection" detail={pageRow.detail} />
      </ul>

      <button className="primary" disabled={!canRead} onClick={() => void extraction.run()}>
        {running ? 'Reading conversation…' : 'Read conversation'}
      </button>
      <p className="hint">{hint}</p>

      <ResultPanel
        state={extraction.state}
        providerName={check.providerName}
        notice={extraction.notice}
        onRetry={() => void extraction.run()}
        onCopyJson={() => void extraction.copyJson()}
        onDownload={extraction.download}
        onCopyVisible={() => void extraction.copyVisibleText()}
      />

      <button className="primary ghost" disabled>
        Create handoff
      </button>
      <p className="hint">Handoff generation arrives in a later phase.</p>

      <fieldset className="targets" disabled>
        <legend>Transfer to</legend>
        {PROVIDERS.map((p) => (
          <span key={p.id} className="chip">
            {p.name}
          </span>
        ))}
      </fieldset>

      <footer className="foot">Everything stays in this browser. No data is sent anywhere.</footer>
    </main>
  );
}
