# Known limitations (for the future context / handoff engine)

Extraction returns text only. These gaps are reported to the user as warnings and must be
handled or disclosed by the Context Engine and Handoff Generator. Do not assume the data exists.

## All providers
- **Images and attachments:** messages that include them keep their text, but the image/file
  data is not captured. Reported as `IMAGES_NOT_CAPTURED` (info).
- **Only the visible conversation branch:** edited messages and regenerated replies are not
  captured unless they are the version currently shown.
- **Streaming replies:** a reply that is still being written is flagged `STILL_GENERATING`.
- **Provider UI artifacts in text:** some UI markers leak into extracted text (for example
  ChatGPT citation/image markers such as `[image]`). Clean these in the normalization stage,
  not in the adapters.

## ChatGPT
- Order is verified against ChatGPT's own turn numbers; gaps are flagged `MISSING_TURNS`.

## Claude
- **Artifacts and created files:** the chat text is captured but artifact contents are not.
  Detection is heuristic (`ARTIFACTS_NOT_CAPTURED`, info). Artifact code is often the most
  important code in a project, so this is a priority gap for a later phase.
- **Thinking / status rows:** empty rows are skipped and counted (`EMPTY_ROWS_SKIPPED`).
  Thinking text is not intentionally captured, but if it shares the reply's text container it
  may appear in the content.
- **Completeness depends on row numbers.** Claude's transcript is a virtual list whose rows carry
  a `data-index` number (verified on the real site in Phase 3).
  When present, the start and end are proven (`diagnostics.strategy = "row-index"`). When absent,
  extraction falls back to page order (`"dom-order"`), cannot prove completeness, and uses the
  weaker scroll sweep; unloaded messages are then ordered by scroll position and flagged.
- **Messages have no stable ids**, so `id` is null.
- **Attachment and artifact detection are heuristics** and may under- or over-report.

## Gemini (Phase 4, verified on the real site)
- **Completeness is evidence-based, not proven.** Gemini rows have no numbering we know of, so the
  start is established by: the top stayed unchanged for a patience window, the first message is
  the user's, nothing was unmounted, and the bottom was reached. If older messages are fetched
  more slowly than the patience window, the start could be misjudged. Increase `topPatienceMs`
  if real testing shows this.
- **Some Gemini selectors were never individually verified** (see `PROJECT_PROGRESS.md`).
  Misses degrade into warnings (`BODY_FALLBACK`, `STARTS_WITH_ASSISTANT`, ...), not silent loss.
- **Images, uploaded files, generated images, Canvas documents and Deep Research reports** are not
  captured. Detection is heuristic (`IMAGES_NOT_CAPTURED`, `ARTIFACTS_NOT_CAPTURED`, info).
- **Thinking blocks** are removed from message text on purpose; other drafts ("Show drafts") are
  not captured, only the visible one.
- **Page unmounting** (if Gemini does it) keeps messages but orders them by scroll position and is
  flagged `UNLOADED_MESSAGES` (warning), so the result is never reported Complete in that case.
- **Duplicate merging** (`DUPLICATES_COLLAPSED`, info) assumes a turn repeated verbatim right after
  itself is a render artifact. A user who repeats the same question and gets an identical answer
  would be merged. This is unlikely and is always reported.
