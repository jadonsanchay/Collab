import type { IncomingMessage, Server as HttpServer } from 'http';
import type { Duplex } from 'stream';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { WebSocket, WebSocketServer } from 'ws';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';

import { canDraw, canView } from '@/common/constants/roles';
import { roomIdSchema } from '@/common/schemas/user';

import type { RoleResolver } from '../auth/roles';
import type { AuthDeps } from '../auth/routes';
import { identityFromCookieHeader } from '../auth/routes';
import type { BoardStore } from '../boards/BoardStore';
import { logger } from '../logger';
import { type DocEntry, type UpdateOrigin, VectorDocStore } from './docStore';

/** y-websocket message kinds. */
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

export const YJS_PATH = '/yjs';

/** A document is at most this much per message; larger is a bug or an attack. */
const MAX_PAYLOAD = 4 * 1024 * 1024;

type Conn = WebSocket & { origin: UpdateOrigin; controlledIds: Set<number>; readOnly: boolean };

export type SyncDeps = {
  store: VectorDocStore;
  boards: BoardStore;
  roles: RoleResolver;
  auth: AuthDeps;
};

const send = (conn: WebSocket, message: Uint8Array) => {
  if (conn.readyState !== WebSocket.OPEN) return;

  conn.send(message, (error) => {
    if (error) conn.close();
  });
};

const broadcastUpdate = (entry: DocEntry, update: Uint8Array, origin: unknown) => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  const message = encoding.toUint8Array(encoder);

  entry.conns.forEach((conn) => {
    if ((conn as Conn).origin !== origin) send(conn as WebSocket, message);
  });
};

const broadcastAwareness = (entry: DocEntry, clients: number[]) => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(
    encoder,
    awarenessProtocol.encodeAwarenessUpdate(entry.awareness, clients),
  );
  const message = encoding.toUint8Array(encoder);

  entry.conns.forEach((conn) => send(conn as WebSocket, message));
};

/** Wires broadcast once per document, the first time a connection opens it. */
const ensureBroadcasting = (entry: DocEntry, wired: WeakSet<DocEntry>) => {
  if (wired.has(entry)) return;
  wired.add(entry);

  entry.doc.on('update', (update: Uint8Array, origin: unknown) => {
    broadcastUpdate(entry, update, origin);
  });

  entry.awareness.on(
    'update',
    ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const changed = [...added, ...updated, ...removed];

      if (origin && typeof origin === 'object' && 'controlledIds' in origin) {
        const conn = origin as Conn;
        added.forEach((id) => conn.controlledIds.add(id));
        removed.forEach((id) => conn.controlledIds.delete(id));
      }

      broadcastAwareness(entry, changed);
    },
  );
};

const handleMessage = (entry: DocEntry, conn: Conn, data: Uint8Array) => {
  const decoder = decoding.createDecoder(data);
  const encoder = encoding.createEncoder();
  const type = decoding.readVarUint(decoder);

  switch (type) {
    case MESSAGE_SYNC: {
      encoding.writeVarUint(encoder, MESSAGE_SYNC);

      const syncType = decoding.readVarUint(decoder);

      if (syncType === syncProtocol.messageYjsSyncStep1) {
        syncProtocol.writeSyncStep2(encoder, entry.doc, decoding.readVarUint8Array(decoder));
      } else if (!conn.readOnly) {
        // Step 2 and plain updates both carry an update; a viewer's is dropped
        // before it can touch the document, which is what read-only means.
        syncProtocol.readUpdate(decoder, entry.doc, conn.origin);
      }

      if (encoding.length(encoder) > 1) send(conn, encoding.toUint8Array(encoder));
      break;
    }

    case MESSAGE_AWARENESS:
      awarenessProtocol.applyAwarenessUpdate(entry.awareness, decoding.readVarUint8Array(decoder), conn);
      break;

    default:
      break;
  }
};

/**
 * Yjs sync over WebSocket on `/yjs/<boardId>`, speaking the y-websocket
 * protocol the client provider expects, on the same HTTP server as
 * Socket.IO. The cookie header authenticates (session or guest) and the
 * board role decides: no access closes the socket, viewers and commenters
 * get a read-only connection whose updates are dropped, editors and owners
 * write. Socket.IO keeps `/socket.io`; anything else on upgrade is refused.
 */
export const attachVectorSync = (server: HttpServer, deps: SyncDeps) => {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
  const wired = new WeakSet<DocEntry>();

  const handleConnection = async (ws: WebSocket, request: IncomingMessage, boardId: string) => {
    const identity = await identityFromCookieHeader(request.headers.cookie, deps.auth);

    if (!identity) {
      ws.close(4401, 'unauthorized');
      return;
    }

    if (!(await deps.boards.ensureLoaded(boardId)) || deps.boards.get(boardId)?.engine !== 'vector') {
      ws.close(4404, 'no such vector board');
      return;
    }

    const role = await deps.roles.roleFor(boardId, identity.userId);

    if (!canView(role)) {
      ws.close(4403, 'forbidden');
      return;
    }

    const entry = await deps.store.open(boardId);
    ensureBroadcasting(entry, wired);

    const conn = ws as Conn;
    conn.origin = { userId: identity.userId, conn };
    conn.controlledIds = new Set();
    conn.readOnly = !canDraw(role);
    conn.binaryType = 'arraybuffer';

    entry.conns.add(conn);

    conn.on('message', (raw) => {
      try {
        const data =
          raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(raw as Buffer);

        handleMessage(entry, conn, data);
      } catch (error) {
        logger.warn({ err: error, boardId }, 'bad yjs message; closing');
        conn.close(1003, 'bad message');
      }
    });

    const cleanup = () => {
      entry.conns.delete(conn);
      awarenessProtocol.removeAwarenessStates(entry.awareness, [...conn.controlledIds], null);
      deps.store.release(boardId);
    };

    conn.on('close', cleanup);
    conn.on('error', cleanup);

    // Sync step 1 and the current awareness, as y-websocket's server does.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, entry.doc);
    send(conn, encoding.toUint8Array(encoder));

    const states = entry.awareness.getStates();

    if (states.size) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(entry.awareness, [...states.keys()]),
      );
      send(conn, encoding.toUint8Array(awarenessEncoder));
    }
  };

  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(request.url ?? '/', 'http://localhost');

    if (!url.pathname.startsWith(`${YJS_PATH}/`)) {
      // Socket.IO handles its own path; nothing else speaks WebSocket here.
      if (!url.pathname.startsWith('/socket.io')) socket.destroy();
      return;
    }

    const boardId = roomIdSchema.safeParse(url.pathname.slice(YJS_PATH.length + 1));

    if (!boardId.success) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      handleConnection(ws, request, boardId.data).catch((error) => {
        logger.error({ err: error }, 'yjs connection failed');
        ws.close(1011, 'error');
      });
    });
  });

  return wss;
};
