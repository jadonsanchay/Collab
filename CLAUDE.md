# Collab — Real-time Collaborative Whiteboard

Next.js + Express + Socket.IO app (package name internally is `board_t`). Users create/join a room and draw together on a shared canvas in real time, with live cursors, chat, and an undo/redo history per user.

## Architecture

- **Custom server**, split into small modules under `server/`:
  - `index.ts` — bootstrap only: parse config, prepare Next, listen.
  - `app.ts` — `createAppServer`, which wires Express, the HTTP server, Socket.IO and the `RoomStore`. It takes the Next request handler as an argument, which is what lets tests boot the whole server without Next.
  - `config.ts` — env parsing with Zod at startup (`PORT`, `NODE_ENV`, `USER_GRACE_MS`, `ROOM_GRACE_MS`, `SWEEP_INTERVAL_MS`).
  - `rooms/RoomStore.ts` — all room state, with no Socket.IO dependency. Unit-testable, and swappable for a persistent store later.
  - `socket/identity.ts` — handshake middleware. `socket/handlers.ts` — every event. `socket/safeHandler.ts` — the try/catch wrapper each handler is wrapped in. `socket/rateLimit.ts` — per-user budgets.
  - `logger.ts` — pino. Server code uses this, not `console` (lint enforces it).
  - Next.js pages/API are NOT used for real-time logic. Dev runs via `tsx watch server/index.ts`, not `next dev`.
- **Identity is a stable `userId`**, not `socket.id`. The client mints a uuid once and keeps it in `localStorage` (`common/lib/identity.ts`), then sends it with `PROTOCOL_VERSION` in the socket handshake. `server/socket/identity.ts` validates both and refuses the connection otherwise — a tab speaking an older protocol is rejected rather than allowed to diverge. Everything server-side is keyed by `userId`.
- **Rooms** live only in server memory: `Map<roomId, ServerRoom>`, keyed by `userId` throughout. No database — state is lost on server restart. Room cap: 12 users. Room ids are 8 base64url characters from `randomBytes(6)`.
- **Presence has three states, not two.** A dropped socket calls `markOffline`, which holds the user's place — colour, moves, undo history — for `USER_GRACE_MS` and broadcasts `user_offline`. `user_disconnected` fires only when that window expires. `rejoin_room(roomId, lastSeq)` reattaches and replies with `room_delta`: just the moves after the sequence number the client reported. Empty rooms are stamped with `emptySince` and swept after `ROOM_GRACE_MS`.
- **Move-based drawing model**: every stroke/shape is a `Move`. The server owns `id`, `timestamp` and `seq`; the client supplies `clientId`. `seq` is monotonic per room and is what clients sort by, so two clients render the same picture — `timestamp` is only a fallback for moves that have not been through the server. A repeated `clientId` is recognised as a resend and not stored twice, which makes a retry safe. `drawed` holds moves from users who left, so their drawing survives them.
- **Client render pipeline**: `useMovesHandlers` merges `movesWithoutUser + myMoves + all other users' moves`, sorts by `seq`, and replays them onto the `<canvas>` via `drawAllMoves`/`drawMove`. Incremental new moves are drawn directly instead of a full replay when possible. A small `Minimap` canvas mirrors the main canvas + background.
- **Drawing interaction**: `useDraw` (in `modules/room/modules/board/hooks/`) owns the live pointer-down/move/up flow, writing directly to the canvas via helpers in `Canvas.helpers.ts` (`drawLine`, `drawCircle`, `drawRect`) before committing a finished `Move`. `mode: 'select'` reuses the same drag flow to define a selection rectangle (used for the image/move overlay) instead of drawing.
- **Validation lives in `common/schemas/`** (Zod 4) and is shared by client and server. **These schemas are the source of truth for the drawing types**: `Move`, `CtxOptions`, `Shape` and `CtxMode` are `z.infer` outputs that `common/types/global.d.ts` re-exports, so the validated wire shape cannot drift from the compile-time type. The server validates every inbound payload and drops what fails.
- **State split**: Recoil atoms per concern under `common/recoil/`:
  - `room` — the current `ClientRoom` (users, moves, my moves)
  - `options` — active tool `CtxOptions` (color, line width, shape, mode, selection)
  - `background` — canvas background setting
  - `savedMoves` — the redo stack (moves popped by undo, replayed on redo)
- **Socket contract** is fully typed in `common/types/global.d.ts` (`ClientToServerEvents` / `ServerToClientEvents`) and shared by client (`common/lib/socket.ts`) and server. Key events: `create_room`, `join_room`, `check_room`, `joined_room` (full snapshot), `rejoin_room`/`room_delta` (resume after a reconnect), `draw`/`your_move`/`user_draw`, `undo`/`user_undo`, `mouse_move`/`mouse_moved`, `send_msg`/`new_msg`, `user_offline`/`user_online`/`user_disconnected`, `rate_limited`.
- **Modules layout** (`modules/`) mirrors feature areas, each with its own `components/`, `hooks/`, `index.ts` barrel:
  - `home` — landing page (create/join room form)
  - `room` — room shell, name-entry gate (`NameInput`), user list, connection banner; contains sub-modules:
    - `board` — canvas, minimap, mouse cursors, moved image, selection buttons
    - `toolbar` — tool/shape/color/line-width pickers, background picker, undo/redo, share modal
    - `chat` — in-room chat panel
  - `modal` — generic modal manager (Recoil-driven, used for "room not found", background/share modals)

## Conventions

- Path alias `@/*` → project root (see `tsconfig.json`). `module: esnext`, `moduleResolution: bundler`, `target: ES2017`.
- Strict TypeScript. ESLint flat config in `eslint.config.mjs` with **Airbnb + Airbnb TypeScript + Airbnb hooks, the Next presets, Tailwind, and Prettier all active**, plus `unused-imports`. Overrides worth knowing: config files and `server/testing/**` may import devDependencies, and `no-console` is *not* disabled for the server — use the pino logger.
- Server code imports within `server/` relatively, and runtime code from `common/` through `@/`. That works because `tsup` bundles; `tsc` would emit an unresolvable `require("@/...")`.
- Tailwind CSS v3 (`darkMode: 'class'`), custom font-size scale, Montserrat font family, content globs cover `pages/`, `common/`, `modules/`.
- Framer Motion for modal/toolbar animations. Use `MotionValue.on('change', …)`, not the deprecated `.onChange()`.
- Toastify (`react-toastify`) for join/leave notifications and rate-limit warnings.
- Recoil state is replaced, never mutated in place — copy Maps and arrays before changing them, or Recoil can skip a re-render on reference equality.

## Build/run

- `npm run dev` — `tsx watch server/index.ts` (the actual dev entrypoint, not `next dev`)
- `npm run build` — `tsup` bundles the server to `build/index.js`, then `next build`
- `npm start` — `NODE_ENV=production node build/index.js`
- `npm run lint` — `eslint .`
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — Vitest: `RoomStore` unit tests, socket integration tests, schema tests, a seeded fuzz test, and client hook tests
- `npm run test:e2e` — Playwright, two browser contexts against a real dev server
- Node 22 (`.nvmrc`). CI runs lint, typecheck, unit tests, a production build, and the e2e suite.

## Testing notes

- Unit and integration tests run on the `node` environment; files needing a DOM opt in with `// @vitest-environment jsdom`.
- Socket tests boot the real server via `createAppServer` with a stubbed Next handler, and each client presents its own `userId` in the handshake.
- Tests that exercise grace windows pass millisecond values through `config` rather than using fake timers — real sockets and fake timers do not mix.
- `safeHandler` catches handler throws, which means a "does not crash" test can pass against genuinely broken code. Tests covering guarded paths also assert `logger.error` was never called; that is the only externally visible difference between a clean early return and a swallowed exception.

## Known gotchas / things to watch for

- Server-side room state is in-memory only (no persistence layer) — a server restart wipes all rooms/drawings. Reconnects survive; restarts do not, until Phase 3.
- Undo/redo is per-user and client-driven (`savedMoves` atom holds the redo stack); the server only tracks moves for replay and leave-persistence, not a global undo stack. Redo re-sends the move with a **fresh** `clientId`, since reusing the old one would be dropped as a duplicate.
- The room snapshot carries this client's own moves under its own id. They must be split into `myMoves`, or the strokes render but undo does nothing.
- Never put internal `RoomUser` fields on the wire — use `toPublicUser`. The record holds a live timer handle that JSON would mangle.
- Rate-limit budgets are keyed by `userId` and are deliberately **not** cleared on disconnect; clearing them would let a throttled client reset its budget by reconnecting.
- Keyboard shortcuts live in `common/lib/keyboard.ts` and accept Cmd or Ctrl. Anything bound to `document` must check `isTypingTarget(e.target)` first, or it will fire while the user types in chat.
- The 1.5 MB base64 image cap is enforced client-side *before* a selection is erased in `useSelection`, because the delete lands immediately while the image is only sent when the user drops it.
- `next build`'s own ESLint step is disabled (`eslint.ignoreDuringBuilds`): Next 15's runner passes eslintrc-era options that ESLint 8 rejects once a flat config exists. Linting happens in its own CI job.
- Do not pipe a long-running server through `head` (`npm run dev | head -40`). `head` exits after N lines and the server then stalls on a broken pipe, which looks exactly like the app hanging.
