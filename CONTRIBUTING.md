# Contributing to Inko

## Setup

```bash
npm install
npm run dev
```

The app runs at `http://localhost:3000` via the custom server (`server/index.ts`) — this is the real dev entrypoint, not `next dev`. See [README.md](README.md) for the full architecture and [CLAUDE.md](CLAUDE.md) for implementation-level notes.

## Before opening a PR

- `npm run lint` — must pass with no errors
- `npx tsc --noEmit` — must pass with no type errors
- There is currently no automated test suite; manually verify your change by running two browser tabs/windows in the same room and confirming drawing, chat, cursors, and undo/redo still sync correctly between them.

## Code conventions

- Use the `@/*` path alias (maps to project root) instead of relative `../../..` imports where it improves readability.
- Follow the existing `modules/<feature>/{components,hooks,modals,recoil}` structure — new features should get their own module under `modules/`, not be bolted onto an existing one.
- Socket events must be added to both `ClientToServerEvents`/`ServerToClientEvents` in `common/types/global.d.ts` and handled on both client and server — never emit or listen for an event that isn't declared there.
- Prefer adding new Recoil state as its own atom + `*.hooks.ts` file under `common/recoil/<concern>/`, mirroring the existing `room`/`options`/`background`/`savedMoves` pattern.
- Keep server-side socket handlers defensive: don't add new non-null assertions (`!`) on `Map.get()` lookups — guard and return early instead.

## Commit style

This repo uses Conventional Commits (`feat:`, `fix:`, `refactor:`, etc.) — match that style, see `git log` for examples.

## Reporting bugs / requesting features

Open an issue describing the room state and steps to reproduce (screen recording helps a lot for sync bugs, since they're timing-dependent).
