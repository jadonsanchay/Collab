import { createServer } from 'http';
import type { IncomingMessage, ServerResponse } from 'http';
import express from 'express';
import { Server } from 'socket.io';

import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@/common/types/global';

import { RoomStore } from './rooms/RoomStore';
import { registerSocketHandlers } from './socket/handlers';

/**
 * Shape of `nextApp.getRequestHandler()`. Declared structurally so tests can
 * pass a stub instead of booting Next.js, which is the whole reason this
 * factory lives apart from `index.ts`.
 */
export type NextRequestHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => void | Promise<void>;

/**
 * Builds the Express app, the HTTP server, and the Socket.IO server, and wires
 * the socket handlers to a fresh `RoomStore`. Does not listen — the caller
 * decides the port, so tests can use an ephemeral one.
 */
export const createAppServer = ({
  nextHandler,
}: {
  nextHandler: NextRequestHandler;
}) => {
  const app = express();
  const server = createServer(app);

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
    /**
     * Explicit rather than left to the 1 MB default, and sized against the
     * 1.5 MB base64 image cap in the move schema plus room for the rest of
     * the payload. A frame larger than this is refused by Socket.IO before a
     * handler ever sees it.
     */
    maxHttpBufferSize: 2 * 1024 * 1024,
  });

  const rooms = new RoomStore();

  registerSocketHandlers(io, rooms);

  app.get('/hello', async (_, res) => {
    res.send('Hello World');
  });

  // Everything else (pages, assets, API routes) falls through to Next.js.
  app.all('*', (req, res) => nextHandler(req, res));

  return { app, server, io, rooms };
};
