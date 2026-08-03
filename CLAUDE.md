# Collab — Real-time Collaborative Whiteboard

Next.js + Express + Socket.IO app (package name internally is `board_t`). Users create/join a room and draw together on a shared canvas in real time, with live cursors, chat, and an undo/redo history per user.

## Architecture

- **Custom server** (`server/index.ts`): Express + `http.createServer` wraps Next.js's request handler and a Socket.IO server. Next.js pages/API are NOT used for real-time logic — everything socket-related lives here. Dev runs via `nodemon server/index.ts` (ts-node under the hood), not `next dev`.
- **Rooms** live only in server memory: `Map<roomId, Room>` where `Room = { usersMoves: Map<socketId, Move[]>, drawed: Move[], users: Map<socketId, username> }`. No database — state is lost on server restart. Room cap: 12 users. Room IDs are random 4-char base36 strings.
- **Move-based drawing model**: every stroke/shape is a `Move` (shape type, path points, circle/rect params, color/width options, optional base64 image, timestamp, uuid). The server assigns the id/timestamp and stores moves per-socket so per-user undo/redo and "moves without a user" (from users who left) can be reconstructed. `drawed` in `Room` = moves from users who disconnected, kept so the drawing persists.
- **Client render pipeline**: `useMovesHandlers` merges `movesWithoutUser + myMoves + all other users' moves`, sorts by `timestamp`, and replays them onto the `<canvas>` via `drawAllMoves`/`drawMove`. Incremental new moves are drawn directly instead of a full replay when possible. A small `Minimap` canvas mirrors the main canvas + background.
- **Drawing interaction**: `useDraw` (in `modules/room/modules/board/hooks/`) owns the live pointer-down/move/up flow, writing directly to the canvas via helpers in `Canvas.helpers.ts` (`drawLine`, `drawCircle`, `drawRect`) before committing a finished `Move`. `mode: 'select'` reuses the same drag flow to define a selection rectangle (used for the image/move overlay) instead of drawing.
- **State split**: Recoil atoms per concern under `common/recoil/`:
  - `room` — the current `ClientRoom` (users, moves, my moves)
  - `options` — active tool `CtxOptions` (color, line width, shape, mode, selection)
  - `background` — canvas background setting
  - `savedMoves` — the redo stack (moves popped by undo, replayed on redo)
- **Socket contract** is fully typed in `common/types/global.d.ts` (`ClientToServerEvents` / `ServerToClientEvents`) and shared by client (`common/lib/socket.ts`) and server. Key events: `create_room`, `join_room`, `check_room`, `joined_room` (client asks for full room snapshot after joining), `draw`/`your_move`/`user_draw`, `undo`/`user_undo`, `mouse_move`/`mouse_moved` (live cursors), `send_msg`/`new_msg`.
- **Modules layout** (`modules/`) mirrors feature areas, each with its own `components/`, `hooks/`, `index.ts` barrel:
  - `home` — landing page (create/join room form)
  - `room` — room shell, name-entry gate (`NameInput`), user list; contains sub-modules:
    - `board` — canvas, minimap, mouse cursors, moved image, selection buttons
    - `toolbar` — tool/shape/color/line-width pickers, background picker, undo/redo, share modal
    - `chat` — in-room chat panel
  - `modal` — generic modal manager (Recoil-driven, used for "room not found", background/share modals)

## Conventions

- Path alias `@/*` → project root (see `tsconfig.json`).
- Strict TypeScript, ESLint via `next/core-web-vitals` + `next/typescript` (flat config, `eslint.config.mjs`). Airbnb + Prettier + Tailwind ESLint plugins are installed as devDependencies but not yet wired into `eslint.config.mjs` (only the Next.js presets are active) — worth checking before assuming Airbnb rules apply.
- Tailwind CSS v3 (`darkMode: 'class'`), custom font-size scale, Montserrat font family, content globs cover `pages/`, `common/`, `modules/`.
- Framer Motion (`MotionConfig` with `DEFAULT_ROOM` easing from `common/constants/easings.ts`) is used for modal/toolbar animations.
- Toastify (`react-toastify`) for join/leave notifications.

## Build/run

- `npm run dev` — nodemon watches `server/index.ts` (this is the actual dev entrypoint, not `next dev`)
- `npm run build` — `tsc --project tsconfig.server.json` (compiles `server/` to `build/`) then `next build`
- `npm start` — `NODE_ENV=production node build/index.js`
- `npm run lint` — `next lint`
- No test suite exists yet.

## Known gotchas / things to watch for

- Server-side room state is in-memory only (no persistence layer) — a server restart wipes all rooms/drawings.
- `addMove`/`undoMove` in `server/index.ts` assume the room and the user's move list already exist (non-null assertions `!`) — joining flows must always initialize `usersMoves` for a socket before `draw`/`undo` can fire.
- Undo/redo is per-user and client-driven (`savedMoves` atom holds the redo stack); the server only tracks moves for replay/leave-persistence, not a global undo stack.
- Ctrl+Z / Ctrl+Y are wired globally via `document.addEventListener('keydown', ...)` in `useMovesHandlers` — no scoping to canvas focus.
