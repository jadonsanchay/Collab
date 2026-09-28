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
- **Client render pipeline uses three stacked canvases**, not one, kept separate specifically so each layer's own clear-and-redraw loop can't wipe another's content: a committed canvas (z-10, the `CommittedRenderer` below), a remote-live canvas (z-15, other users' in-progress strokes), and a local-live canvas (z-20, this user's own in-progress stroke). `useMovesHandlers` merges `movesWithoutUser + myMoves + all other users' moves`, sorts by `seq`, and feeds the committed canvas; a small `Minimap` canvas mirrors the main canvas + background.
- **`CommittedRenderer`** (`modules/room/render/CommittedRenderer.ts`) is a checkpoint-bitmap renderer for fast undo on large boards: it keeps a `createImageBitmap` snapshot plus a tail of moves since that snapshot, and replays only the tail instead of every move from scratch. Scheduling is rAF-coalesced via a `frameScheduled` boolean set *before* calling `requestAnimationFrame` — setting it from the callback's return value instead is a real bug that silently drops every `schedule()` call after the first synchronous callback.
- **Drawing interaction**: `useDraw` (in `modules/room/modules/board/hooks/`) owns the live pointer-down/move/up flow via the Pointer Events API (unifying mouse/touch/pen), writing directly to the local-live canvas via helpers in `helpers/Canvas.helpers.ts` (`drawLine`, `drawCircle`, `drawRect`) before committing a finished `Move`. `mode: 'select'` reuses the same drag flow to define a selection rectangle (used for the image/move overlay) instead of drawing. `useLiveStrokeBroadcast`/`useLiveStrokes` stream in-progress strokes to other clients (`stroke_start/points/end` → volatile, unstored server relay → `live_stroke_start/points/end`) so remote strokes appear before the drawer lifts the pointer; `strokeId` is the same value as the eventual move's `clientId`.
- **Viewport**: `common/store/viewport.store.ts` holds pan/zoom/hand-tool state and is applied as a CSS `transform: translate(x,y) scale(scale)` on a wrapper div — canvas pixel dimensions stay fixed at 4000×2000. `common/lib/coords.ts` (`toBoard`/`toScreen`) converts between board and screen space. `useViewportBroadcast` relays viewport changes for follow mode; `cursor`/`summon` events (also volatile, rate-limited server relays) drive remote cursors and "bring everyone to your view".
- **Validation lives in `common/schemas/`** (Zod 4) and is shared by client and server. **These schemas are the source of truth for the drawing types**: `Move`, `CtxOptions`, `Shape` and `CtxMode` are `z.infer` outputs that `common/types/global.d.ts` re-exports, so the validated wire shape cannot drift from the compile-time type. The server validates every inbound payload and drops what fails.
- **State split**: Zustand stores per concern under `common/store/`:
  - `room` — the current `ClientRoom` (users, moves, my moves)
  - `options` — active tool `CtxOptions` (color, line width, shape, mode, selection)
  - `background` — canvas background setting
  - `history` — the redo stack (moves popped by undo, replayed on redo)
  - `drawing`, `viewport`, `liveStrokes`, `presence` — in-progress draw state, pan/zoom/hand-tool, remote live-stroke buffers, and cursor/online state, respectively
  - Reactive reads use the hook form (`useXStore((state) => state.y)`); hot-path/non-reactive code (drawing, viewport math) reads and writes imperatively via `getState()`/`setState()` instead of subscribing.
- **Socket contract** is fully typed in `common/types/global.d.ts` (`ClientToServerEvents` / `ServerToClientEvents`) and shared by client (`common/lib/socket.ts`) and server. Key events: `create_room`, `join_room`, `check_room`, `joined_room` (full snapshot), `rejoin_room`/`room_delta` (resume after a reconnect), `draw`/`your_move`/`user_draw`, `undo`/`user_undo`, `stroke_start`/`stroke_points`/`stroke_end`/`live_stroke_start`/`live_stroke_points`/`live_stroke_end`, `cursor`/`viewport`/`summon`, `send_msg`/`new_msg`, `user_offline`/`user_online`/`user_disconnected`, `rate_limited`. `mouse_move`/`mouse_moved` still exist on the wire and server (`server/socket/handlers.ts`, `rateLimit.ts`) but nothing on the client emits or listens for them anymore — superseded by `cursor`/`viewport`.
- **Modules layout** (`modules/`) mirrors feature areas, each with its own `components/`, `hooks/`, `index.ts` barrel:
  - `home` — landing page (create/join room form)
  - `room` — room shell, name-entry gate (`NameInput`), `TopBar` (board name, user list, share), `CommandPalette` (⌘K), `ShortcutsSheet` (`?`); contains sub-modules:
    - `board` — the three-layer canvas, minimap, cursor broadcaster/layer, moved image, selection bar, zoom controls, plus `render/CommittedRenderer`
    - `toolbar` — tool/shape/color/line-width pickers (shadcn/Radix `ToggleGroup`/`Popover`/`Slider`), background picker, undo/redo, share modal, global tool hotkeys (`useToolHotkeys`); `ToolbarActionsContext` mounts the shared image-paste listener exactly once so multiple consumers (toolbar, command palette) don't double-register it
    - `chat` — in-room chat panel
  - `modal` — generic modal manager (Zustand-driven, Framer Motion animated, used for "room not found", background/share modals)
- **shadcn/ui primitives** live in `common/components/ui/` — Radix UI wrapped with `cn()` (clsx + tailwind-merge), CSS-variable-based theme tokens. `HotkeyTooltip` (`common/components/HotkeyTooltip.tsx`) composes `Tooltip` + `Kbd` around a toolbar control; because Radix `Tooltip.Trigger asChild` and the wrapped control can both want to own `data-state` on the same DOM node (Tooltip's wins), style any wrapped control's own active/selected state off a different attribute (e.g. `aria-checked`), not `data-[state=on]`.

## Conventions

- Path alias `@/*` → project root (see `tsconfig.json`). `module: esnext`, `moduleResolution: bundler`, `target: ES2017`.
- Strict TypeScript. ESLint flat config in `eslint.config.mjs` with **Airbnb + Airbnb TypeScript + Airbnb hooks, the Next presets, Tailwind, and Prettier all active**, plus `unused-imports`. Overrides worth knowing: config files and `server/testing/**` may import devDependencies, and `no-console` is *not* disabled for the server — use the pino logger.
- Server code imports within `server/` relatively, and runtime code from `common/` through `@/`. That works because `tsup` bundles; `tsc` would emit an unresolvable `require("@/...")`.
- Tailwind CSS v3.4 (`darkMode: 'class'`), custom font-size scale, Montserrat font family, content globs cover `pages/`, `common/`, `modules/`. Staying on 3.4 for now — see the Tailwind 4 decision record in `docs/roadmap/phase-1-canvas-and-presence.md` (Step 9): the Tailwind-4-compatible `eslint-plugin-tailwindcss` major requires ESLint 9/10, which this repo's Airbnb-based ESLint 8 setup doesn't support yet.
- Framer Motion for modal animations only; the toolbar (Step 8) moved to shadcn/Radix primitives instead. Use `MotionValue.on('change', …)`, not the deprecated `.onChange()`.
- Sonner (`sonner`'s `toast()` / `<Toaster />`) for join/leave notifications and rate-limit warnings — not `react-toastify`, which is blocked by an ESLint `no-restricted-imports` rule alongside `react-icons` (use `lucide-react` for icons).
- `lucide-react` for icons; `react-icons` is blocked by the same rule.
- Zustand state is replaced, never mutated in place — copy Maps and arrays before changing them and pass the copy to `set()`, or a component reading the same reference can skip a re-render.
- `cmdk` (via `common/components/ui/command.tsx`) backs the command palette.

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
- macOS's filesystem is case-insensitive: `modules/room/modules/toolbar/components/ToolBar.tsx` and a hypothetical `Toolbar.tsx` are the same file on disk even though git tracks the casing. Writing a "new" file with different casing than an existing one silently overwrites it in place. Keep using the existing casing (`ToolBar.tsx`) rather than fighting a case-only rename.
- Two browser tabs in the same Chrome profile share `localStorage`, so they get the same `userId` — for manual multi-user testing, force a distinct identity in one tab first: `localStorage.setItem('collab:userId', crypto.randomUUID())` then reload.
- A client joining a room after other users are already present does not see those existing users in its own avatar list (the reverse direction works via the `new_user` broadcast). Pre-existing bug, not yet fixed.
