# AI Handoff

Chrome extension (Manifest V3, TypeScript, React) that carries project context from one AI assistant to another.
Local-first: no backend, no uploads, no AI API.

## Status

**Phases 1-4 are COMPLETE and verified on the real sites:** extension foundation, and conversation extraction for
**ChatGPT, Claude and Gemini** into one normalized schema, with completeness checks and warnings.
**Next phase: Phase 5 - Context Engine (not started).** Later: handoff generation, transfer, project memory,
security/polish.

**Start with [`PROJECT_PROGRESS.md`](./PROJECT_PROGRESS.md)**: the project's source of truth (goal, architecture,
phase status and history, test results, limitations, exact stopping point). Known limitations for the future
Context Engine are in [`docs/KNOWN-LIMITATIONS.md`](./docs/KNOWN-LIMITATIONS.md).

```
npm install
npm run build      # then load dist/ in chrome://extensions (Developer mode > Load unpacked)
npm run typecheck
npm test           # 63 automated tests (chatgpt, claude, gemini, markdown, registry)
```
