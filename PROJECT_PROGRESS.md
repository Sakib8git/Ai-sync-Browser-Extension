# AI Handoff - PROJECT_PROGRESS.md

> **Persistent source of truth.** A new AI must be able to read only this file and continue the work.
> Keep it current. Never delete historical phase information. Update it whenever you complete a
> feature, change architecture, fix a bug, find a limitation, add/remove/rename important files,
> run meaningful tests, change phase, or make an important technical decision.

**Last updated:** 2026-10-07, after the real-world Gemini verification (Phase 4 closed)
**Extension version:** 0.4.0

## CURRENT STATUS (read this first)

**Phases 1-4 are COMPLETE and verified on the real sites** (provider extraction for ChatGPT, Claude and Gemini).

| | |
|---|---|
| **Current phase** | None active. Phase 4 was just closed. |
| **Last COMPLETE phase** | Phase 4 - Gemini conversation extraction (verified on the real Gemini site) |
| **NEXT phase** | **Phase 5 - Context Engine. NOT STARTED.** Do not implement it until the user says to begin. |
| **Next step** | Wait for the user's go-ahead, then begin Phase 5 (brief recorded in section 6, "Phase 5 - NEXT"). |

> Note on this file's history: it did **not exist** before the Phase 4 session. It was created then.
> Sections for Phases 1-3 were reconstructed from the code, the tests and the development chat, so
> small details from those phases may be missing. From Phase 4 onward it is maintained live.

---

## 1. Project goal

A Chrome extension (**AI Handoff**) that carries a project's context from one AI assistant to another.

Problem: the user works for a long time with AI-A, hits its usage/context limit, switches to AI-B, and
AI-B knows nothing (instructions, decisions, completed work, code, current state), so everything must be
re-explained.

Long-term pipeline: extract conversation -> understand project context -> preserve instructions,
decisions, completed work, important code, unresolved problems, exact current state, next tasks ->
create a **Handoff Package** -> open AI-B -> inject it -> AI-B continues without restarting.

Providers: ChatGPT, Claude, Gemini (adapter architecture so others can be added later).

Three-layer context model (for the future Context Engine): **Project context** (long-term),
**Conversation context** (decisions, rejected ideas, problems), **Active state** (exactly where the
previous AI stopped; the most important layer). Do not summarise code carelessly: preserve important
code, prefer the latest version of a file, do not duplicate repeated code.

## 2. Non-negotiable rules (from the user)

- **Build incrementally.** Per phase: explain, build the smallest working version, give exact
  install/test steps, **wait for the user's real-world test result**, fix problems, only then move on.
  Never skip phases. Never mark a phase COMPLETE without the user's confirmation.
- **Do not start future phases early.** Only the active phase.
- **Privacy / local-first:** no backend, no auth, no external servers, no silent uploads, no stored API
  keys, minimal permissions (currently only `activeTab`). Data lives in the popup's memory only until
  Phase 8 adds local storage. Design so a sensitive-data scanner can be added later.
- **Fail gracefully and never pretend completeness.** Extraction must warn when it cannot guarantee
  completeness. The user must always know which AI was detected, what is being read, whether the result is
  complete, what could not be captured, where data is stored, and whether any external AI/API is used.
- **One architecture.** Provider-specific DOM knowledge stays inside that provider's adapter. Reuse shared
  utilities. Do not invent competing extraction architectures.
- Code must be modular, typed, production-oriented. No fake or placeholder features presented as complete.
- Do not assume provider selectors are permanent.

## 3. Tech stack and commands

Chrome Extension, Manifest V3, TypeScript (strict), React for the popup, **esbuild** (custom
`scripts/build.mjs`; no CRXJS/Vite because MV3 content scripts cannot be ES modules), jsdom + `node:test`
for tests. No backend. Node 20+. User is on **Windows + Chrome**.

```
npm install
npm run build        # produces dist/ ; load dist/ via chrome://extensions > Developer mode > Load unpacked
npm run dev          # rebuild on change
npm run typecheck
npm test             # bundles tests/*.test.ts with esbuild, runs node --test (jsdom)
```
After a rebuild: click reload on the extension card AND reload the AI tab.

Manifest: `permissions: ["activeTab"]`; content script matches `chatgpt.com`, `chat.openai.com`,
`claude.ai`, `gemini.google.com`. No host permissions, no `storage`/`tabs` permission yet.

## 4. Architecture

```
Popup (React)  --chrome.tabs.sendMessage-->  Content script (runs on each AI site)
   |                                              |
   +--- adapters/registry (URL -> adapter) <------+
Service worker: thin scaffold (onInstalled + PING). Reserved for transfer/storage phases.
```

- The popup detects the provider from the tab URL, then handshakes with the content script
  (`GET_PAGE_STATUS` -> provider, isConversation, canExtract, title).
- **Read conversation** sends `EXTRACT_CONVERSATION`; the content script runs
  `adapter.extractConversation(document, url)` and returns `ExtractionResponse`.
- **Copy visible text** (`GET_VISIBLE_TEXT`) is the manual fallback on failure.
- The result is shown in the popup (counts, warnings, Copy JSON, Download JSON, preview). It is held in
  popup memory only. Nothing is saved or sent anywhere.

### Folder map (src/)

```
shared/
  providers.ts        ProviderId, PROVIDERS (ChatGPT/Claude/Gemini)
  messages.ts         namespaced runtime message types, PageStatus, VisibleTextResponse
  conversation.ts     ExtractedConversation schema, warning codes, ExtractionDiagnostics, ExtractionError
adapters/
  types.ts            ProviderAdapter interface (detection + optional extractConversation)
  registry.ts         detectAdapter(url)
  title.ts            cleanTitle(tabTitle, brandNames)
  markdown.ts         domToMarkdown: HTML -> Markdown (code fences w/ language, lists, tables, links, KaTeX math)
  plaintext.ts        domToPlainText: user-typed text with whitespace preserved
  dom.ts              sleep, waitFor, findScroller, setScrollTop, settle, sweepScroller (ChatGPT + Claude fallback),
                      waitForQuiet (unused leftover), loadOlder, captureViewAnchor/restoreViewAnchor (Gemini)
  pageOrder.ts        resolvePageOrder, collapseRenderDuplicates (Gemini)
  chatgpt/            index.ts, extract.ts      (all ChatGPT selectors in extract.ts)
  claude/             index.ts, extract.ts (flow), read.ts (selectors + one-message reader), rows.ts (row-index sweep)
  gemini/             index.ts, extract.ts (flow), read.ts (selectors + one-message reader)
  generic/            placeholder adapter (never matched)
background/index.ts   service worker scaffold
content/index.ts      message router; BUSY guard; maps ExtractionError -> response; never logs content
popup/                App.tsx, ResultPanel.tsx, usePageCheck.ts, useExtraction.ts, summary.ts, styles.css, main.tsx, popup.html
tests/                *.test.ts + helpers/virtualList.ts (Claude sim), helpers/geminiList.ts (Gemini sim)
docs/KNOWN-LIMITATIONS.md   limitations for the future Context Engine
scripts/build.mjs (esbuild + generated PNG icons), scripts/test.mjs
```

### Normalized schema (`ExtractedConversation`)

`{ schemaVersion: 1, provider, conversationId, title, url, extractedAt, messages[{index, id, role: 'user'|'assistant', content (Markdown)}], warnings[{code, severity: 'warning'|'info', message}], complete, diagnostics? }`

`complete` is false whenever any **warning**-severity item exists. **Info** items are documented limitations
that do not block completeness.

### Warning codes (src/shared/conversation.ts)

Blocking (`warning`): `STILL_GENERATING`, `MISSING_TURNS` (ChatGPT turn gaps), `STARTS_WITH_ASSISTANT`,
`ORDER_UNVERIFIED`, `UNLOADED_MESSAGES`, `EARLIEST_NOT_VERIFIED`, `LATEST_NOT_VERIFIED`, `ROWS_MISSING`.
Informational: `IMAGES_NOT_CAPTURED`, `ARTIFACTS_NOT_CAPTURED`, `EMPTY_ROWS_SKIPPED`, `BODY_FALLBACK`,
`DUPLICATES_COLLAPSED`. (`STARTS_WITH_ASSISTANT` is only info for Claude when row 0 is verified.)

### Per-provider extraction strategy

| Provider | Message detection | Order / completeness evidence | Loading older messages |
|---|---|---|---|
| ChatGPT | `[data-message-author-role]` | `conversation-turn-N` numbers; gaps flagged | scroll to top until stable, sweep down (`sweepScroller`) |
| Claude | `[data-testid="user-message"]`, `.font-claude-response` | **`data-index` row numbers** of the TanStack-style virtual list: row 0 reached, no holes, bottom reached twice (`rows.ts`). Falls back to page order (`dom-order`) if rows are not numbered | adaptive sweep, scroll restored by re-finding the anchor row |
| Gemini | `user-query`, `model-response` custom elements | page order + evidence: top stable for patience window, first message is the user's, bottom reached, nothing unmounted | `loadOlder` (patient, nudges away from top and back), then `sweepScroller` down |

### Important technical decisions

1. esbuild instead of CRXJS/Vite (content scripts must be IIFE).
2. Only `activeTab` permission; status computed on demand so SPA navigation needs no tracking.
3. HTML -> Markdown converter swaps code blocks for placeholders so code whitespace is never altered;
   user text uses a separate plaintext reader (whitespace is meaningful).
4. Adapters own all site knowledge; selectors are marked reported/guess and degrade into warnings.
5. **Never silently partial:** unverifiable start/end/order => warning => `complete: false`.
6. Claude uses the page's own row numbers as the ordering signal because scroll offsets and fixed timings
   failed on real conversations (see Phase 3).
7. Gemini has no known row numbers, so completeness is evidence-based and `UNLOADED_MESSAGES` always
   blocks "Complete". The Claude row-index path and its verified fallback were **left untouched** in
   Phase 4; Gemini got its own flow built from shared utilities (`loadOlder`, anchors, `pageOrder`).
8. Duplicate-merge (`collapseRenderDuplicates`): only AI replies may be partial copies; user text must be
   identical. (A bug where user messages "Q" and "Q2" were merged was found and fixed by a test.)
9. Diagnostics are part of the result so real-world failures can be diagnosed without exposing content.

---

## 5. Phase roadmap and status

| # | Phase | Status |
|---|---|---|
| 1 | Extension foundation | COMPLETE |
| 2 | ChatGPT conversation extraction | COMPLETE |
| 3 | Claude conversation extraction | COMPLETE |
| 4 | Gemini conversation extraction | COMPLETE (verified on the real Gemini site) |
| **5** | **Context Engine** (**NEXT - not started**; separate project/instructions/decisions/rejected ideas/completed work/current state/bugs/code/files/next steps/constraints; do not blindly summarise; normalise provider artifacts) | not started |
| 6 | Handoff Generator (structured package, with an explicit "you are taking over, do not restart" instruction) | not started |
| 7 | Transfer (copy handoff, open target AI, inject; safe fallback = open + clipboard) | not started |
| 8 | Project Memory (local IndexedDB projects) | not started |
| 9 | Advanced memory (versions, code tracking, search, merge) | not started |
| 10 | Security and production polish (sensitive-data scanner, settings, export/import, accessibility) | not started |

---

## 6. Phase history

### Phase 1 - Extension Foundation - COMPLETE
- Manifest V3, esbuild build, React popup, service worker scaffold, content script, adapter registry,
  provider detection (URL-based), generated icons, premium-style popup with a "baton pass" visual
  (current AI -> next AI), status rows (AI website / Conversation / Extension connection), honest disabled
  buttons for unbuilt features.
- Real-world: user confirmed it loads, detects the AI website, the conversation and the connection (tested on Claude).

### Phase 2 - ChatGPT extraction - COMPLETE
- ChatGPT adapter (`[data-message-author-role]`, turn numbers), Markdown converter, shared model, warnings,
  popup Read conversation / Copy JSON / Download JSON / preview, Copy visible text fallback, jsdom tests.
- Real-world: user verified conversation ID, title, URL, user/assistant messages, order, Bangla/Banglish,
  Markdown, links, code blocks, long conversations. A conversation with 20 messages, 63,574 characters and
  53 code blocks returned 10 user + 10 assistant, Complete.
- Known and accepted: images/attachments are not captured (text only, warned). ChatGPT UI artifacts such as
  `[[image]...]` citation/image markers leak into assistant text. **Do not fix in adapters; handle in the
  Phase 5 normalisation stage.**

### Phase 3 - Claude extraction - COMPLETE
- Claude adapter, user plaintext reader, code-block header cleanup (language label -> fence language),
  warnings for attachments/artifacts/streaming/empty rows, jsdom tests.
- **Incident:** real conversation "AI sync" returned only 5 messages (2 user / 3 Claude) with warnings
  "Claude removed some messages..." and "begins with an AI message". Short chats ("HTML widget form with
  responsive design": 10 messages, Complete) had worked.
- **Root cause (inferred):** Claude's transcript is a virtual list. The old sweep (a) stopped waiting for older
  messages after ~1s of unchanged height, (b) ordered messages by scroll offset, (c) never proved the start
  was reached.
- **Fix:** each virtual-list row carries a `data-index` number (reported by third-party tools; later verified
  on the real site). Rows are collected by that number, so ordering and de-duplication need no scroll
  geometry. Completeness is proven: row 0 reached, no holes below the highest row, bottom reached twice with
  the same highest row. Adaptive step sweep (halve and retry on a hole), scroll restored by re-finding the
  anchor row, overall time budget ends as "unverified", not a quiet partial. If rows are not numbered it falls
  back to page order (cannot prove completeness; warned).
- **Process note:** the workspace already contained this fix from an earlier session when the later session
  began; a competing design started in the later session was set aside and **not shipped**.
- Real-world (final): conversation "map location plugin": 12 messages, 6 user / 6 Claude, 9,688 characters,
  2 code blocks, rows 0-11 verified, all rows read first to latest, **Complete**.
- Remaining Claude limitations (accepted, documented in docs/KNOWN-LIMITATIONS.md): attachment/image contents
  and Claude artifact/file contents are not captured (heuristic info warnings); only the currently displayed
  branch of edited/regenerated replies; thinking text is not intentionally captured; messages have no stable
  ids (`id` is null); a more reliable future option (reading claude.ai's own same-origin conversation data
  endpoint) was deliberately **not** built because it is undocumented and beyond the DOM approach.

### Phase 4 - Gemini extraction - COMPLETE

**Goal:** add a Gemini adapter that returns the same `ExtractedConversation`, detects Gemini conversation
pages, extracts id/title/URL/user + model messages in chronological order with Markdown, code blocks, lists,
tables, links and Bangla/Banglish text; handles lazy-loaded/virtualized transcripts; preserves scroll position;
warns instead of returning silent partial data; adds diagnostics; warns about attachments/images/files; no
changes to ChatGPT/Claude behaviour; Gemini selectors only inside the Gemini adapter.
**Explicitly not part of Phase 4:** Context Engine, summarisation, Project Memory, transfer/injection,
file/image/artifact transfer, handoff generation.

**Implementation status: done and verified.** Automated tests passed first; the user then verified it on the real site.

**Real-world test (PASSED, 2026-10-07, run by the user on the real Gemini website):**
- Conversation: "Loading Bar Timing and URL Issue"
- 32 messages: 16 user / 16 Gemini
- 125,044 characters, 11 code blocks
- Status: **Complete**, no missing-message or unverified warnings
- The attachment/image limitation appeared as expected and is documented.
- What this does and does not prove: the Gemini selector set worked end to end on this long conversation
  (message detection, ordering, older-message loading, code blocks). Individual guessed selectors were not
  audited one by one; tables, math, thinking blocks, Canvas and generated images were not reported as
  specifically exercised.

Approach (no ground truth of the live DOM was available; selectors come from third-party exporters/userscripts):
- Conversation URLs: `/app/<id>`, `/u/<n>/app/<id>`, `/gem/<gemId>/<id>`; id = last segment. `/app` and `/gem/<id>` alone are not conversations.
- Messages are `user-query` / `model-response` elements (nested wrappers `.user-query-container` / `response-container` are de-nested). One message per element, in page order.
- User text: one `p.query-text-line` per line (whitespace kept, nbsp -> space). Model text: top-level `.markdown`; fallback `message-content`/`.response-content` + `BODY_FALLBACK` info.
- Cleanup on a clone: removes visually-hidden labels ("You said"), buttons, `copy-button`, `message-actions`, `sources-list`, `thinking-overlay`/`model-thoughts` (thinking is intentionally dropped), table footer ("Export to Sheets"), source footnotes; code-block language label (`.code-block-decoration span`) becomes the fence language; math via `[data-math]` becomes `$..$` / `$$..$$`.
- Loading: `loadOlder` returns to the top until it has stayed unchanged for `topPatienceMs` (default 2500 ms), nudging away and back each round (lazy loaders fire on arrival); then `sweepScroller` walks down; the reader's place is restored by re-finding the first visible message (`captureViewAnchor`/`restoreViewAnchor`; bottom readers return to the bottom).
- Order: still-mounted messages sort by DOM position. If Gemini unmounts messages, they are kept, de-duplicated by content and ordered by recorded scroll offset, and flagged `UNLOADED_MESSAGES` (result not Complete).
- Duplicate renders: neighbouring identical messages / whole repeated turns are merged keeping the fuller AI copy; reported as `DUPLICATES_COLLAPSED`.
- Completeness (all must hold for `complete: true`): not generating, top stable for the patience window, bottom reached, first message is the user's, nothing unmounted.
- Diagnostics (`diagnostics`): `strategy: "dom-order"`, `reachedTop`, `reachedBottom`, `startEvidence` (`top-stable` | `not-scrollable` | `not-verified`), `loadRounds`, `messagesRead`, `duplicatesCollapsed`, `scrollerFound`, `elapsedMs`.

**Evidence level of Gemini selectors** (update after real testing):
- Reported by third-party tools: `infinite-scroller[data-test-id="chat-history-container"]` / `infinite-scroller.chat-history`, `.conversation-container`, `user-query`, `.user-query-container`, `.query-text`, `p.query-text-line`, `model-response`, `response-container`, `.response-content`, `message-content`, tab title suffix "Google Gemini".
- **Guesses (unverified):** `.markdown` as the answer body, `code-block` + `.code-block-decoration span` language label, `[data-math]`, `.table-footer`, thinking/source/footnote element names, stop-button selectors, attachment/image/Canvas selectors (`uploader-file-preview`, `generated-image`, `immersive-entry-chip`, ...), sidebar selected-title selectors.

**Files created (Phase 4):**
`src/adapters/gemini/extract.ts`, `src/adapters/gemini/read.ts`, `src/adapters/pageOrder.ts`,
`tests/gemini.test.ts`, `tests/gemini-sweep.test.ts`, `tests/helpers/geminiList.ts`, `PROJECT_PROGRESS.md`, `README.md`.

**Files modified (Phase 4):**
`src/adapters/gemini/index.ts` (adds `extractConversation`, Gem URLs), `src/adapters/dom.ts` (added `loadOlder`,
`captureViewAnchor`, `restoreViewAnchor`; existing functions unchanged), `src/shared/conversation.ts`
(`DUPLICATES_COLLAPSED`, optional diagnostics fields), `tests/registry.test.ts`, `docs/KNOWN-LIMITATIONS.md`,
`package.json` + `public/manifest.json` (version 0.4.0).
ChatGPT and Claude source files were not modified.

**Automated tests (2026-10-07, before the real-world verification):** `npm run typecheck` clean; `npm run build` OK; `npm test` **63 / 63 pass**
(chatgpt 5, claude 14, claude-virtualized 10, markdown 5, registry 4, gemini 17, gemini-sweep 8).
Gemini tests cover: short chats, long lazy-loaded chats, loader that fires only on arrival at the top,
scroll restoration (bottom and middle), unmount/re-create (flagged), duplicate renders, order, timeout =>
unverified, code blocks (label -> language, chrome removed), headings/lists/tables/links/math, Bangla/Banglish,
user whitespace, hidden labels/thinking/footnotes, streaming, model-first start, empty rows, attachments /
generated images / Canvas, body fallback, sidebar-title fallback, errors, `/u/n` and Gem ids.
**All tests run on a simulated Gemini DOM written by us, not the live site.**

**Known limitations (Gemini):** see docs/KNOWN-LIMITATIONS.md.
- Attachments and images are not fully captured (text only; info warning `IMAGES_NOT_CAPTURED`).
- Generated images and Canvas documents are not fully captured (info warning `ARTIFACTS_NOT_CAPTURED`);
  Deep Research reports, thinking text and alternative drafts are also not captured.
- Gemini DOM selectors may change at any time. Some were never individually verified; misses degrade into
  warnings (`BODY_FALLBACK`, `STARTS_WITH_ASSISTANT`, ...), not silent loss.
- Completeness relies on the current detection strategy (evidence-based, not proven: top unchanged for the
  patience window, bottom reached, first message is the user's, nothing unmounted). If Gemini loads older turns
  slower than `topPatienceMs` (2500 ms) the start could be misjudged; raise it if that is ever observed.
- Page unmounting, if Gemini ever does it, always yields an incomplete (warned) result.
- The duplicate merge could wrongly merge a verbatim-repeated identical turn (always reported).

**Real Gemini test procedure (used for the verification above; keep for regression testing):**
1. `npm install` then `npm run build`; reload the extension in `chrome://extensions`; reload the Gemini tab.
2. Open a short Gemini chat (2-4 turns) on `gemini.google.com/app/<id>`; click **Read conversation**. Check title,
   counts, role alternation, Complete badge, and open **Preview data**.
3. Check code blocks (fence with language, no "Copy code" text), a list, a table (no "Export to Sheets"), links,
   Bangla/Banglish text and user line breaks.
4. Open a **long** Gemini chat (30+ turns) scrolled to the middle; read; confirm the page returns to the same place
   and that message count/first/last match what Gemini shows. Run it twice: counts must match.
5. Read while Gemini is still typing: expect a "Check warnings" streaming warning.
6. Try a chat with an uploaded image/file, a generated image, a Canvas document: expect info notes, no crash.
7. Regression: re-run one ChatGPT and one Claude read.
8. If anything is off, send `diagnostics` from Preview data plus the outer HTML of one user turn and one model turn
   (text replaced by placeholders; no real conversation content), and the DevTools numbers:
   `document.querySelectorAll('user-query').length`, `model-response`, `.conversation-container`,
   `infinite-scroller`, `.markdown`, `code-block`.

**What the user verified manually / should re-check after any Gemini change:** (a) message count and order equal the real chat; (b) `Complete` appears
only when it really is complete; (c) the start of a long chat is reached (older turns load); (d) code, tables,
math and Bangla render correctly; (e) scroll position is restored; (f) no ChatGPT/Claude regression;
(g) which guessed selectors need correcting (report `diagnostics.startEvidence`, warnings, BODY_FALLBACK).

---

### Phase 5 - Context Engine - NEXT (NOT STARTED)

Status: **not started.** The user has supplied the full Phase 5 specification but asked that it NOT be implemented
yet. When told to begin, re-read this file, `README.md` and the spec, and follow it. Summary of the brief:
- Build a local Context Engine (suggested location `src/context/`, separate from provider adapters) that turns the
  raw `ExtractedConversation` into a structured, high-fidelity handoff context. Provider adapters answer "what did
  the conversation contain?"; the Context Engine answers "what does the next AI need to know to continue?".
- Extract: project/task goal, requirements (explicit, constraints, preferences, behaviour, design, technical),
  important instructions (preserve verbatim), completed work, current state, decisions, problems/bugs (problem,
  attempted solution, status, remaining action), next steps (immediate / future / blocked), technical details
  (filenames, functions, selectors, URLs, APIs, libraries, commands, config, errors, test results, versions),
  code and exact content (never summarise important code away).
- Raw conversation stays the source of truth and is never replaced. Every extracted item should carry source
  message indexes. Old vs current requirements must be distinguished (latest explicit user instruction wins unless
  the conversation says otherwise); contradictions must not be silently merged; uncertainty must be marked, never
  invented. Also produce a human-readable "Project Handoff" Markdown view.
- No external AI API, backend or cloud. Leave room for an optional AI-assisted layer later.
- Tests required for 14 scenarios (simple, requirements, multiple/conflicting/repeated instructions, decisions,
  completed work, bugs, next steps, code, Bangla/Banglish, mixed, long, changed requirements).
- Must not start Phase 6 (handoff UI, transfer, injection, external summarisation, cloud sync, file transfer).
- Document the final schema, strategy, files and tests in this file; mark the phase `IN PROGRESS / TESTING` until
  the user verifies it.
- Also carry in the Phase 5 normalisation stage: clean provider UI artifacts in text (e.g. ChatGPT `[[image]...]`).

## 7. Known issues and limitations (project-wide)

- Images/attachments, Claude artifacts/files, Gemini Canvas/generated images are not captured (text only; info warnings).
- Only the visible conversation branch is captured (edited/regenerated replies).
- Provider UI markers can leak into text (e.g. ChatGPT `[[image]...]`): to be cleaned in Phase 5 normalisation.
- Gemini completeness is evidence-based (verified on one long real conversation; see Phase 4 limitations).
- `waitForQuiet` in `dom.ts` is an unused leftover (safe to delete). Claude's page-order fallback duplicates logic
  that now lives in `pageOrder.ts`; it was left unchanged on purpose because the Claude path is verified.
- Popup result is lost when the popup closes (no storage until Phase 8).

## 8. Maintenance protocol for any AI continuing this project

1. Read this file fully, then `docs/KNOWN-LIMITATIONS.md`, then the adapter you are touching.
2. Follow section 2. Do not start the next phase until the user confirms the current one by real-world testing.
3. Run `npm run typecheck`, `npm test`, `npm run build` before reporting.
4. Update this file at the end of every task: phase status, summary, files changed, decisions, automated and
   real-world test results, known issues, next steps, and the exact stopping point.

## 9. Exact stopping point

Phases 1-4 are COMPLETE and verified on the real ChatGPT, Claude and Gemini sites. The last code change was the
Phase 4 implementation (automated suite 63/63 before verification; typecheck and build clean). The user then
verified Gemini on the real site (32 messages, 125,044 characters, 11 code blocks, Complete). This session only
updated documentation: `PROJECT_PROGRESS.md`, `README.md`, `docs/KNOWN-LIMITATIONS.md`. No source code changed.
**Development stopped here. Phase 5 (Context Engine) is the NEXT phase and has NOT been started.** Do not start
it until the user asks.
