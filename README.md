# Collab — Real-time Collaborative Whiteboard

Collab (internal package name `board_t`) is a real-time collaborative whiteboard. Anyone can create a room, share the room ID, and draw together live — with synced strokes/shapes/images, live cursors, per-user undo/redo, and in-room chat.

Live at: [collab-x6r1.onrender.com](https://collab-x6r1.onrender.com/)

For deeper implementation notes (module layout, conventions, gotchas), see [CLAUDE.md](CLAUDE.md).

## Features

- Freehand line drawing, circles, rectangles, text, and image pasting, with adjustable line width/color and fill color
- Eraser mode and a rectangular selection tool (for moving pasted images)
- Real-time sync of all drawing across everyone in the room
- Live mouse cursors showing where other users are pointing
- Per-user undo/redo (Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z or Ctrl+Y)
- In-room chat
- A minimap of the current board
- Custom canvas background picker
- Room sharing via a short room ID/link
- Sessions that survive a dropped connection: your place, colour and history are held while you reconnect
- **Sketch, an AI teammate** (opt-in): joins the room with a cursor, cleans up a selection, draws from a prompt or an `@sketch` chat mention, and summarizes the board as stickies; its work is undoable as one action. See [docs/ai-teammate.md](docs/ai-teammate.md)
- **Rewind**: scrub the board's history, filter by author, play it back, and export a WebM timelapse
- **Boards that last** (with storage on): a dashboard of your boards with templates, thumbnails, rename, duplicate, star and delete; server-rendered snapshots for fast loads
- **Accounts and roles** (with storage on): sign up with a name, username, email and password, or with Google or GitHub; guests keep working and are merged on sign-in; owner, editor, commenter and viewer roles enforced server-side; invitation links with a role and an expiry
- **Objects boards** (beta): an infinite board of selectable objects — pen strokes, shapes, text, sticky notes, connectors, frames — synced through a Yjs document, with move/resize/rotate, snapping, in-place text editing two people can share, per-user undo, SVG export, Sketch drawing editable objects, Rewind over the document history, and one-click conversion of an existing drawing board. See [docs/object-model.md](docs/object-model.md)

## Architecture

Collab does **not** use Next.js's own dev/prod server. `server/index.ts` is a custom Express server that wraps Next.js's request handler and hosts a Socket.IO server on the same HTTP server instance. All real-time behavior (rooms, drawing, chat, cursors) goes through Socket.IO; Next.js only serves pages/assets.

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│           Browser           │        │        Node process          │
│                              │        │                              │
│  Next.js pages (React)      │◄──────►│  Express + http.Server        │
│  ├─ Recoil (client state)   │  HTTP  │  ├─ Next.js request handler   │
│  └─ socket.io-client         │◄──────►│  └─ Socket.IO server          │
│                              │  WS    │      └─ in-memory Room store │
└─────────────────────────────┘        └──────────────────────────────┘
```

Objects boards add a second WebSocket on the same port: `/yjs/<boardId>` speaks the y-websocket protocol to a Yjs document the server keeps in memory and, with storage on, in Postgres. One rule keeps the two apart: Yjs carries durable objects, Socket.IO carries everything ephemeral (cursors, presence, chat, AI status) and the drawing boards' moves.

Live room state is held in server memory (a `Map<roomId, ServerRoom>`) and, when storage is configured, recorded in Postgres so boards survive restarts and deploys. The default is memory only; `STORAGE=pglite` keeps boards in an embedded Postgres with no infrastructure, and `DATABASE_URL` uses a hosted Postgres. See [docs/operations.md](docs/operations.md).

### Data model

| Type                 | Where                      | What it represents                                                                                                                                                                                                                                                        |
| -------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Move`               | `common/schemas/move.ts`   | One drawing operation: shape type, path points, circle/rect params, line/fill color + width, optional base64 image or text. The server assigns `id`, `timestamp`, `seq` and `userId`; the client supplies `clientId`. Defined as a Zod schema, with the TypeScript type inferred from it. |
| `ServerRoom`         | `server/rooms/types.ts`    | Keyed by the stable `userId`, not by socket: `{ users, usersMoves, drawed, seq, clientIds, emptySince }`. `usersMoves` holds each user's own move history (for per-user undo). `drawed` holds moves from users who have left — kept so their drawing persists.            |
| `ClientRoom`         | `common/types/global.d.ts` | The client's local mirror: `usersMoves` (other users' moves, keyed by `userId`), `movesWithoutUser` (from `drawed`), `myMoves` (this user's own moves, enabling instant local undo/redo), and `users` (`userId` → `{ name, color, offline }`).                            |

The client reconstructs the board by merging `movesWithoutUser + myMoves + everyone else's usersMoves`, sorting by the server-assigned `seq`, and replaying each `Move` onto the `<canvas>` (see `useMovesHandlers` in `modules/room/hooks/`). New moves are drawn incrementally on top rather than triggering a full replay where possible. This works without a CRDT/OT layer because drawing operations are additive/commutative — unlike collaborative text editing, two people's strokes never need to be merged or transformed against each other.

### Room lifecycle

0. **Handshake**: the client sends a `userId` it keeps in `localStorage`, plus `PROTOCOL_VERSION`. Both are required; a tab speaking an older protocol is refused rather than allowed to diverge.
1. **Create**: client emits `create_room(username)` → server generates an 8-character base64url room ID, creates the room, assigns the creator a colour, and emits `created(roomId)`. Client navigates to `/[roomId]`.
2. **Join**: client emits `join_room(roomId, username)` → if the room exists and has fewer than 12 users, the socket joins and the server emits `joined(roomId)`; otherwise `joined('', true)` (failed).
3. **Snapshot**: once on the room page, client emits `joined_room()` → server replies with the full `room` payload (all moves + users so far) and broadcasts `new_user` to everyone else already in the room.
4. **Draw**: client emits `draw(move)` → server validates it, assigns `id`/`timestamp`/`seq`, stores it under that user's move list, echoes it back as `your_move` and broadcasts it as `user_draw`. A `clientId` the room has already seen is treated as a resend and ignored, so retrying is safe.
5. **Undo**: client emits `undo()` → server pops that socket's last stored move and broadcasts `user_undo(userId)` so others remove it too. Redo is purely client-side (replays a previously-undone move as a fresh `draw`).
6. **Cursor/chat**: `cursor(x, y)` → volatile broadcast as `cursor_moved`; `send_msg(msg)` → broadcast (including back to sender) as `new_msg`.
7. **Drop**: on socket `disconnecting`, the user is marked offline and `user_offline` is broadcast. Their place — colour, moves, undo history — is held for `USER_GRACE_MS`. Reconnecting within that window emits `rejoin_room(roomId, lastSeq)` and the server replies with `room_delta`: only the moves that were missed.
8. **Leave**: on explicit `leave_room`, or once the grace window expires, the server folds that user's moves into `drawed` (so the drawing persists), removes them, and broadcasts `user_disconnected(userId)`. An empty room is swept after `ROOM_GRACE_MS`.

9. **AI** (when `AI_ENABLED`): `ai_request` → `ai_status` updates to the room while Sketch, a synthetic member, moves its cursor and emits ordinary `user_draw` moves; `ai_undo` → `moves_removed(ids)` on every client.

10. **Objects boards**: created with `create_room(username, { engine: 'vector' })` or from the dashboard. The room lifecycle above still applies; the drawing itself is a Yjs document on `/yjs/<roomId>`, and the server tells every window about an engine change with `board_engine`.

The full typed event contract lives in `common/types/global.d.ts` (`ClientToServerEvents` / `ServerToClientEvents`) and is shared by both client and server. Once per connection the server sends `features`, which tells the client which optional features (AI, Rewind) exist here.

## Getting started

```bash
npm install
npm run dev
```

This starts the custom server (`server/index.ts` via `tsx watch`) on `http://localhost:3000` — **not** `next dev`. Both the Next.js app and the Socket.IO server run on this one process/port.

Node 22 is expected (see `.nvmrc`).

### Environment variables

| Variable            | Default  | Purpose                                                                                                |
| ------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| `PORT`              | `3000`   | Port the Express/Socket.IO/Next.js server listens on                                                   |
| `NODE_ENV`          | —        | Set to `production` for `npm start` to run the bundled server; anything else runs Next.js in dev mode  |
| `USER_GRACE_MS`     | `60000`  | How long a disconnected user keeps their place in the room                                             |
| `ROOM_GRACE_MS`     | `1800000`| How long an empty room is kept before its drawing is discarded                                         |
| `SWEEP_INTERVAL_MS` | `60000`  | How often expired users and empty rooms are looked for                                                 |
| `AI_ENABLED`        | `false`  | Turns on Sketch, the AI teammate. Needs a key or `AI_FAKE`                                             |
| `AI_FAKE`           | `false`  | Deterministic agent for development and tests: no key, no network                                      |
| `AI_PROVIDER`       | —        | `anthropic` or `openai`; unset picks whichever key is present                                          |
| `ANTHROPIC_API_KEY` | —        | Enables the Anthropic agent (`AI_MODEL`, default `claude-opus-5-5`)                                    |
| `OPENAI_API_KEY`    | —        | Enables the OpenAI agent (`OPENAI_MODEL`, default `gpt-5.5`)                                           |
| `REWIND_ENABLED`    | `true`   | Shows the Rewind panel                                                                                 |
| `DEFAULT_ENGINE`    | `vector` | Engine for new boards. `raster` is the legacy drawing engine, kept for boards made before the switch |
| `STORAGE`           | derived  | `memory`, `pglite` or `postgres`. Unset: `postgres` if `DATABASE_URL` is set, else `pglite` if `PGLITE_DIR` is set, else memory |
| `DATABASE_URL`      | —        | Hosted Postgres                                                                                        |
| `PGLITE_DIR`        | `.data/pglite` | Embedded Postgres directory for `STORAGE=pglite`                                                 |
| `REDIS_URL`         | —        | Cross-node broadcasts and shared rate limits                                                           |
| `AUTH_SECRET`       | dev secret outside production | Signs sessions, guest cookies and upload URLs; required in production                     |
| `AUTH_GOOGLE_ID/SECRET`, `AUTH_GITHUB_ID/SECRET` | — | OAuth providers                                                                       |
| `AUTH_DEV_LOGIN`    | `false`  | Email-only dev sign-in (never in production)                                                           |
| `S3_BUCKET` and friends | —    | S3-compatible object storage instead of the local `/uploads` directory                                 |

All are parsed and validated at startup, so a bad value fails immediately rather than becoming `NaN` inside a timer. The full list with defaults is in [docs/operations.md](docs/operations.md).

With no variables set, nothing external is used. `STORAGE=pglite npm run dev` keeps boards across restarts with no database server. The only third-party API is the model behind Sketch, and only when `AI_ENABLED` is set with a key; `AI_ENABLED=1 AI_FAKE=1 npm run dev` exercises the whole feature without one.

## Scripts

| Script                 | What it does                                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`          | Runs `server/index.ts` via `tsx watch` (auto-restarts on server changes; Next.js's own fast-refresh still applies to pages)         |
| `npm run build:server` | Bundles `server/index.ts` to `build/index.js` via `tsup`                                                                            |
| `npm run build:next`   | Runs `next build`                                                                                                                   |
| `npm run build`        | Runs both of the above, in order — required before `npm start`                                                                      |
| `npm start`            | `NODE_ENV=production node build/index.js` — serves the bundled server + built Next.js app                                           |
| `npm run lint`         | `eslint .`                                                                                                                          |
| `npm run typecheck`    | `tsc --noEmit`                                                                                                                      |
| `npm test`             | `vitest run` — unit, socket integration, fuzz, renderer pixel, and AI pipeline tests                                                |
| `npm run test:watch`   | `vitest` in watch mode                                                                                                              |
| `npm run test:e2e`     | `playwright test` — two browser contexts against a real dev server started with the fake AI agent and embedded Postgres            |
| `npm run db:generate`  | `drizzle-kit generate` — a new migration from `server/db/schema.ts`                                                                |
| `npm run db:migrate`   | Applies pending migrations to the configured database and exits                                                                    |
| `npm run dev:infra`    | `docker compose up -d` — Postgres, Redis and MinIO for the hosted-style setup                                                      |

The server is **bundled** rather than compiled file-by-file, because it imports
runtime code from `common/` (the Zod schemas) through the `@/*` alias. `tsc`
emits such an import verbatim as `require("@/common/...")`, which Node cannot
resolve; esbuild inlines it instead. Dependencies stay external.

## Deployment

Currently deployed on [Render](https://render.com) as a web service named "collab": [collab-x6r1.onrender.com](https://collab-x6r1.onrender.com/).

Because Collab runs a **custom, long-lived Node server** (Express + Socket.IO) rather than Next.js's own server or serverless functions, it needs a host that runs a persistent Node process with WebSocket support — e.g. Render, Railway, Fly.io, or a VM/container platform. It is **not** a good fit for Vercel's default serverless deployment model, since that doesn't support a custom long-running server process or persistent Socket.IO connections.

To deploy anywhere that runs a Node process:

1. `npm install`
2. `npm run build` (bundles the server to `build/index.js` and builds the Next.js app)
3. `npm start` (or configure the platform's start command to run the same: `NODE_ENV=production node build/index.js`)
4. Ensure the platform exposes the port from `process.env.PORT` and proxies WebSocket upgrades through to it

Without storage configured, all state is in memory and lost on every redeploy or restart. Set `DATABASE_URL` (and `AUTH_SECRET`, object storage, optionally `REDIS_URL`) for a real deployment; a `Dockerfile`, a `fly.toml` for two machines and a tag-triggered deploy workflow are included. Runbooks and the full variable list are in [docs/operations.md](docs/operations.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
