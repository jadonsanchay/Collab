# Collab — Real-time Collaborative Whiteboard

Collab (internal package name `board_t`) is a real-time collaborative whiteboard. Anyone can create a room, share the room ID, and draw together live — with synced strokes/shapes/images, live cursors, per-user undo/redo, and in-room chat.

Live at: [collab-x6r1.onrender.com](https://collab-x6r1.onrender.com/)

For deeper implementation notes (module layout, conventions, gotchas), see [CLAUDE.md](CLAUDE.md).

## Features

- Freehand line drawing, circles, rectangles, and image pasting, with adjustable line width/color and fill color
- Eraser mode and a rectangular selection tool (for moving pasted images)
- Real-time sync of all drawing across everyone in the room
- Live mouse cursors showing where other users are pointing
- Per-user undo/redo (Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z or Ctrl+Y)
- In-room chat
- A minimap of the current board
- Custom canvas background picker
- Room sharing via a short room ID/link
- Sessions that survive a dropped connection: your place, colour and history are held while you reconnect

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

Room/drawing state lives **only in server memory** (a `Map<roomId, ServerRoom>`) — there is no database. A dropped *connection* is survivable (see [Room lifecycle](#room-lifecycle)), but restarting the *server* drops every active room and drawing.

### Data model

| Type                 | Where                      | What it represents                                                                                                                                                                                                                                                        |
| -------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Move`               | `common/schemas/move.ts`   | One drawing operation: shape type, path points, circle/rect params, line/fill color + width, optional base64 image. The server assigns `id`, `timestamp` and `seq`; the client supplies `clientId`. Defined as a Zod schema, with the TypeScript type inferred from it.    |
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
6. **Cursor/chat**: `mouse_move(x, y)` → broadcast as `mouse_moved`; `send_msg(msg)` → broadcast (including back to sender) as `new_msg`.
7. **Drop**: on socket `disconnecting`, the user is marked offline and `user_offline` is broadcast. Their place — colour, moves, undo history — is held for `USER_GRACE_MS`. Reconnecting within that window emits `rejoin_room(roomId, lastSeq)` and the server replies with `room_delta`: only the moves that were missed.
8. **Leave**: on explicit `leave_room`, or once the grace window expires, the server folds that user's moves into `drawed` (so the drawing persists), removes them, and broadcasts `user_disconnected(userId)`. An empty room is swept after `ROOM_GRACE_MS`.

The full typed event contract lives in `common/types/global.d.ts` (`ClientToServerEvents` / `ServerToClientEvents`) and is shared by both client and server.

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

All are parsed and validated at startup, so a bad value fails immediately rather than becoming `NaN` inside a timer.

There is no `.env` requirement beyond these — no database or third-party API keys are used.

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
| `npm test`             | `vitest run` — unit, socket integration, and fuzz tests                                                                             |
| `npm run test:watch`   | `vitest` in watch mode                                                                                                              |
| `npm run test:e2e`     | `playwright test` — two browser contexts against a real dev server                                                                  |

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

There is no database or external service to provision — all state is in-memory, so expect room/drawing data to be lost on every redeploy or restart (see [CLAUDE.md](CLAUDE.md) for the scalability implications of this).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
