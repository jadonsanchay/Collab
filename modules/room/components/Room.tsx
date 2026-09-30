import dynamic from 'next/dynamic';

import ErrorBoundary from '@/common/components/ErrorBoundary';
import { useRoom } from '@/common/store/room.store';

import RoomContextProvider from '../context/Room.context';
import { ToolbarActionsProvider } from '../modules/toolbar/context/ToolbarActions.context';
import ConnectionBanner from './ConnectionBanner';
import Board from '../modules/board';
import Chat from '../modules/chat';
import { HistoryBanner, RewindPanel } from '../modules/rewind';
import Toolbar from '../modules/toolbar';
import AiSync from './AiSync';
import CommandPalette from './CommandPalette';
import NameInput from './NameInput';
import ShortcutsSheet from './ShortcutsSheet';
import TopBar from './TopBar';

/**
 * The vector engine is its own chunk: raster boards, still the default,
 * never download the Yjs client or the vector renderer.
 */
const VectorBoard = dynamic(() => import('@/modules/vector'), { ssr: false });

const Room = () => {
  const room = useRoom();

  if (!room.id) return <NameInput />;

  const vector = room.engine === 'vector';

  return (
    <ErrorBoundary>
      <RoomContextProvider>
        <ToolbarActionsProvider>
          <div className="relative size-full overflow-hidden">
            <AiSync />
            <ConnectionBanner />
            <TopBar />
            {!vector && <Toolbar />}
            <CommandPalette />
            <ShortcutsSheet />
            {vector ? <VectorBoard /> : <Board />}
            <Chat />
            {!vector && <RewindPanel />}
            {!vector && <HistoryBanner />}
          </div>
        </ToolbarActionsProvider>
      </RoomContextProvider>
    </ErrorBoundary>
  );
};

export default Room;
