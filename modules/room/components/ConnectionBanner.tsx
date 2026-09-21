import { useEffect, useState } from 'react';

import { socket } from '@/common/lib/socket';

/**
 * Tells the user when the board is not live.
 *
 * Without this, a dropped connection looks exactly like a room where nobody
 * else is drawing: strokes keep appearing locally and simply never reach
 * anyone. The reload case is separate and terminal — a tab speaking an older
 * protocol is refused at the handshake, and no amount of retrying will help.
 */
const ConnectionBanner = () => {
  const [connected, setConnected] = useState(socket.connected);
  const [needsReload, setNeedsReload] = useState(false);

  useEffect(() => {
    const handleConnect = () => setConnected(true);
    const handleDisconnect = () => setConnected(false);

    const handleConnectError = (error: Error) => {
      setConnected(false);

      // Refused by the handshake middleware, not a network problem.
      if (error.message === 'protocol_mismatch') setNeedsReload(true);
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
    };
  }, []);

  if (needsReload)
    return (
      <div className="pointer-events-auto absolute left-1/2 top-0 z-50 flex -translate-x-1/2 items-center gap-3 rounded-b-lg bg-red-600 px-4 py-2 text-white shadow-lg">
        <span>A new version of Collab is available.</span>
        <button
          className="rounded bg-white/20 px-2 py-1 font-bold hover:bg-white/30"
          type="button"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    );

  if (connected) return null;

  return (
    <div className="pointer-events-none absolute left-1/2 top-0 z-50 -translate-x-1/2 rounded-b-lg bg-zinc-800 px-4 py-2 text-white shadow-lg">
      Reconnecting…
    </div>
  );
};

export default ConnectionBanner;
