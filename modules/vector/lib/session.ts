import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';

import { getMyUserId } from '@/common/lib/identity';
import { useVectorStore } from '@/common/store/vector.store';
import { createUndoManager, observeObjects, readAll } from '@/common/vector/doc';

export type VectorSession = {
  doc: Y.Doc;
  provider: WebsocketProvider;
  undo: Y.UndoManager;
  /** Transaction origin for this client's own changes; the undo manager tracks it. */
  origin: { userId: string };
  destroy: () => void;
};

const wsUrl = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';

  return `${protocol}://${window.location.host}/yjs`;
};

/**
 * Opens the board's Yjs document and keeps `vector.store` mirrored to it.
 * The provider speaks the y-websocket protocol to `/yjs/<boardId>` on this
 * origin; cookies ride along with the upgrade, which is how the server
 * knows who this is and what they may do.
 */
export const openVectorSession = (boardId: string): VectorSession => {
  const doc = new Y.Doc();
  const origin = { userId: getMyUserId() };
  const provider = new WebsocketProvider(wsUrl(), boardId, doc, { disableBc: true });
  const undo = createUndoManager(doc, origin);
  const store = useVectorStore.getState;

  const mirror = () => store().setObjects(readAll(doc));

  const stopObserving = observeObjects(doc, mirror);
  mirror();

  const onStatus = ({ status }: { status: string }) => store().setConnected(status === 'connected');
  provider.on('status', onStatus);

  if (process.env.NODE_ENV !== 'production') {
    // A handle for the e2e suite and for poking at the document in dev tools.
    (window as unknown as { collabVector?: unknown }).collabVector = { doc, undo, provider, store: useVectorStore };
  }

  return {
    doc,
    provider,
    undo,
    origin,
    destroy: () => {
      stopObserving();
      provider.off('status', onStatus);
      undo.destroy();
      provider.destroy();
      doc.destroy();
      store().reset();
    },
  };
};
