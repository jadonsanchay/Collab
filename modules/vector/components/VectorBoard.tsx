import { useCallback, useEffect, useRef, useState } from 'react';

import { canDraw } from '@/common/constants/roles';
import { getMyUserId } from '@/common/lib/identity';
import { socket } from '@/common/lib/socket';
import { VectorRenderer } from '@/common/render/vector/Renderer';
import { useMyRole, useRoom } from '@/common/store/room.store';
import { useVectorStore, type VectorTool, visibleObjects } from '@/common/store/vector.store';

import CursorBroadcaster from '@/modules/room/modules/board/components/CursorBroadcaster';
import CursorLayer from '@/modules/room/modules/board/components/CursorLayer';
import { usePresenceSync } from '@/modules/room/hooks/usePresenceSync';
import { useViewportBroadcast } from '@/modules/room/modules/board/hooks/useViewportBroadcast';
import { HistoryBanner } from '@/modules/room/modules/rewind';

import { useVectorInteractions } from '../hooks/useVectorInteractions';
import { useVectorKeyboard } from '../hooks/useVectorKeyboard';
import { openVectorSession, type VectorSession } from '../lib/session';
import TextEditorOverlay from './TextEditorOverlay';
import VectorRewindPanel from './VectorRewindPanel';
import VectorToolbar from './VectorToolbar';
import VectorZoomControls from './VectorZoomControls';

/** Pointer cursor per tool; anything not listed draws, so it gets a crosshair. */
const CURSOR_BY_TOOL: Partial<Record<VectorTool, string>> = {
  hand: 'grab',
  select: 'default',
};

/**
 * A vector board: one full-window canvas driven by `VectorRenderer`, the
 * Yjs session for its objects, and the shared room chrome (cursors, follow
 * mode, chat, AI status) on Socket.IO exactly as raster boards have it.
 */
const VectorBoard = () => {
  const { id: roomId } = useRoom();
  const role = useMyRole();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<VectorRenderer | null>(null);
  const [session, setSession] = useState<VectorSession | null>(null);
  const tool = useVectorStore((state) => state.tool);
  const connected = useVectorStore((state) => state.connected);

  const { handlePointerDown, handlePointerMove, handlePointerUp, handleDoubleClick, handleWheel, cancelDrag } =
    useVectorInteractions(session, rendererRef, getMyUserId());

  useVectorKeyboard(session);
  usePresenceSync();
  useViewportBroadcast();

  // Presence over Socket.IO needs the room snapshot, same as the raster board.
  useEffect(() => {
    socket.emit('joined_room');
  }, []);

  useEffect(() => {
    useVectorStore.getState().setReadOnly(!canDraw(role));
  }, [role]);

  useEffect(() => {
    if (!roomId) return undefined;

    const opened = openVectorSession(roomId);
    setSession(opened);

    return () => {
      opened.destroy();
      setSession(null);
    };
  }, [roomId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const renderer = new VectorRenderer(canvas);
    rendererRef.current = renderer;

    const resize = () => renderer.resize(window.innerWidth, window.innerHeight);
    resize();
    window.addEventListener('resize', resize);

    const unsubscribe = useVectorStore.subscribe((state, previous) => {
      if (visibleObjects(state) !== visibleObjects(previous)) renderer.setObjects(visibleObjects(state));
      if (state.camera !== previous.camera) renderer.setCamera(state.camera);
      if (state.selection !== previous.selection) renderer.setSelection({ ids: state.selection });
    });

    const initial = useVectorStore.getState();
    renderer.setObjects(visibleObjects(initial));
    renderer.setCamera(initial.camera);
    renderer.setSelection({ ids: initial.selection });

    return () => {
      unsubscribe();
      window.removeEventListener('resize', resize);
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []);

  const contentBounds = useCallback(() => rendererRef.current?.contentBounds() ?? null, []);

  const cursor = CURSOR_BY_TOOL[tool] ?? 'crosshair';

  return (
    <div className="relative size-full overflow-hidden" onWheel={handleWheel}>
      <canvas
        ref={canvasRef}
        data-engine="vector"
        className="absolute left-0 top-0 z-10"
        style={{ touchAction: 'none', cursor }}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={cancelDrag}
        onDoubleClick={handleDoubleClick}
      />

      {!connected && (
        <div className="pointer-events-none absolute left-1/2 top-16 z-40 -translate-x-1/2 rounded-full bg-zinc-800 px-3 py-1 text-xs text-white">
          Connecting to the document…
        </div>
      )}

      <CursorBroadcaster />
      <CursorLayer />
      {session && <TextEditorOverlay session={session} />}
      <VectorToolbar session={session} />
      <VectorZoomControls contentBounds={contentBounds} />
      <HistoryBanner />
      <VectorRewindPanel />
    </div>
  );
};

export default VectorBoard;
