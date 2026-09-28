import ErrorBoundary from '@/common/components/ErrorBoundary';
import { useRoom } from '@/common/store/room.store';

import RoomContextProvider from '../context/Room.context';
import { ToolbarActionsProvider } from '../modules/toolbar/context/ToolbarActions.context';
import ConnectionBanner from './ConnectionBanner';
import Board from '../modules/board';
import Chat from '../modules/chat';
import Toolbar from '../modules/toolbar';
import CommandPalette from './CommandPalette';
import NameInput from './NameInput';
import ShortcutsSheet from './ShortcutsSheet';
import TopBar from './TopBar';

const Room = () => {
  const room = useRoom();

  if (!room.id) return <NameInput />;

  return (
    <ErrorBoundary>
      <RoomContextProvider>
        <ToolbarActionsProvider>
          <div className="relative size-full overflow-hidden">
            <ConnectionBanner />
            <TopBar />
            <Toolbar />
            <CommandPalette />
            <ShortcutsSheet />
            <Board />
            <Chat />
          </div>
        </ToolbarActionsProvider>
      </RoomContextProvider>
    </ErrorBoundary>
  );
};

export default Room;
