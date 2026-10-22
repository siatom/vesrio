<div align="center">

# 文屿 · Vesrio

**An island for your words.**

`Windows 11` · `Tauri 2` · `Vue 3` · `CodeMirror 6` · `v0.1.0`

[English](./README.md) · [简体中文](./README.zh-CN.md)

</div>

> **Your words. Your voice.**

Vesrio is a local-first Markdown writing desk for Windows 11 — a quiet room where the author keeps the pen and the agent learns to wait.

Most AI writing tools begin with an empty page and end in someone else's voice. Vesrio begins where writing actually happens: inside a sentence you have already chosen, at a desk you already trust. You edit directly. When you want company, select a passage and ask. The model answers with candidates, never corrections. Nothing touches the page until you say yes.

## The premise

**The author holds the pen.** The editor is the main interface; conversation is a side door. Writing is not a prompt awaiting completion.

**A suggestion is a guest.** Inline AI works only on the selection you grant it. Every candidate arrives as a diff, waits beside the sentence, and leaves no trace if refused. Acceptance is one decision; regret is one undo.

**Yesterday's patch does not land today.** If the source changed while the model was thinking, the suggestion is marked stale and cannot be applied. A beautiful sentence in the wrong place is still damage.

**The file outlives the app.** Your `.md` stays plain Markdown that any editor can open — no proprietary markers, no lock-in. Vesrio's own memory (sessions, styles, snapshots) lives beside your text, never inside it.

## What V0.1 holds

- **A surface that disappears.** CodeMirror 6 editing with live preview, source mode, outline, tabs, focus and review modes, light and dark themes, and a typographic measure you can adjust.
- **Inline AI, close to the sentence.** Shorten, polish, or rewrite from the floating toolbar or `Ctrl + J`; one to three candidates; side-by-side diff review; accept, reject, switch, and a single-step undo. Stale suggestions are blocked.
- **An agent that reads, not writes.** A side-panel conversation whose citations jump back into the text, with per-document history and a project style card. Read-only by design.
- **Memory with a conscience.** Atomic saves, external-change conflict handling, snapshots before acceptance and restoration, API keys in Windows Credential Manager, and redacted logs.
- **A real desktop artifact.** SQLite migrations, a unified error vocabulary, and a Windows x64 NSIS installer.

## Status, honestly

V0.1 is feature-complete and covered by automated verification: a 24-file byte-fidelity golden corpus, stale-patch race tests, failure-safe AI paths, Rust contract tests, and desktop E2E against real WebView2.

Still open: the full journey on a clean Windows machine, upgrade migration, installer code signing, and a beta with real long-form writers. The details live in [known issues](./docs/known-issues.md) and the [release checklist](./docs/release-checklist.md). We would rather say this plainly than pretend the last mile is already behind us.

## What it declines to do

No cloud. No account. No telemetry. No multiplayer. No mobile app. No autonomous full-document rewrite, no cross-document RAG, no automatic publishing.

These are not gaps waiting to be filled; they are the shape of the product. Attention is the scarce resource, and a writing desk should not compete with the writer.

## The stack

| Layer | Choice |
| --- | --- |
| Desktop shell | Tauri 2 / Rust |
| Interface | Vue 3 + TypeScript + Vite |
| Editor | CodeMirror 6 |
| State | Pinia |
| Metadata | SQLite (rusqlite, bundled) |
| Credentials | Windows Credential Manager (keyring) |
| Model access | OpenAI-compatible HTTP + SSE (reqwest / rustls) |
| Tooling | pnpm + Cargo |

Vesrio speaks to any OpenAI-compatible endpoint. The default preset is DeepSeek Flash (`deepseek-flash`); OpenAI and custom base URLs are one setting away.

## Requirements

- Windows 11 x64 (WebView2 Runtime on development machines).
- Node.js ≥ 20 and pnpm 11.
- Rust stable (MSVC toolchain) and Visual Studio Build Tools with C++ desktop support.
- Running the packaged app requires neither Node nor Rust.

## First light

```bash
pnpm install
pnpm dev          # front end only (browser; no desktop capabilities)
pnpm tauri:dev    # the real desk
pnpm build        # type check + production build
pnpm tauri:build  # Windows NSIS installer
```

The installer lands at `src-tauri/target/release/bundle/nsis/Vesrio_0.1.0_x64-setup.exe`.

## Before you trust it

```bash
# Front end
pnpm typecheck
pnpm lint
pnpm test                 # Vitest unit tests
pnpm test:e2e             # Playwright E2E (local Chrome + mock backend)
pnpm test:desktop         # real Tauri/WebView2 desktop E2E
pnpm build

# Rust (inside src-tauri)
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test

# Content and delivery
pnpm check:golden         # byte fingerprints for 24 golden Markdown samples
pnpm check:licenses       # regenerate docs/licenses-report.md
pnpm checksums            # regenerate release/SHA256SUMS.txt
```

> E2E uses `src/lib/mockBackend.ts` (DEV plus `VITE_MOCK_BACKEND=true`) to exercise interface and timing. It does not replace Rust backend or real-model acceptance; contracts, file fidelity, and performance are covered by `cargo test`.

## Where your words live

- Your `.md` files never receive application-private markers. A save with no edits writes nothing to disk.
- Application data lives in `%APPDATA%\com.vesrio.app`:
  - `vesrio.db` — projects, sessions, suggestions, styles, snapshot index, audit events.
  - `snapshots/` — snapshot copies of document text.
  - `logs/` — redacted logs.
- API keys exist only in Windows Credential Manager (service `com.vesrio.app`). No plaintext key reaches SQLite or the logs.
- Before anything is sent to a model, the interface shows the exact scope and character count. Text never crosses projects silently.
- Uninstalling Vesrio does not delete your source `.md` files; whether to remove application data is your decision.

## Repository map

```text
src/                     Vue UI, editor, state, inline AI, agent, settings
src-tauri/src/           Tauri commands, document, storage, provider, suggestion, security
src-tauri/migrations/    SQLite migrations
tests/unit/              Front-end unit tests
tests/e2e/               Playwright E2E
tests/fixtures/markdown/ Golden Markdown corpus and fingerprints
scripts/                 Golden checks, licenses, checksums
docs/                    PRD, plan, WBS, ADRs, user and release documents
```

## Further reading

Project documents are currently written in Simplified Chinese.

- [User guide](./docs/user-guide.md)
- [Technical reference: commands, data model, migrations](./docs/technical-reference.md)
- [Security and privacy audit](./docs/security-audit.md)
- [Known issues and limits](./docs/known-issues.md)
- [Release checklist and rollback](./docs/release-checklist.md)
- [Third-party license report](./docs/licenses-report.md)
- [Architecture decision records](./docs/adr/README.md)
- [Product requirements](./docs/prd.md) · [Development plan](./docs/development-plan.md) · [WBS](./docs/wbs.md)

## License

Vesrio is released under the [MIT License](./LICENSE). Third-party license notices are listed in [docs/licenses-report.md](./docs/licenses-report.md).

---

<div align="center"><sub>Write slowly. Keep the voice.</sub></div>
