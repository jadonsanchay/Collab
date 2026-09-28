import Canvas from './components/Canvas';
import CursorBroadcaster from './components/CursorBroadcaster';
import CursorLayer from './components/CursorLayer';
import MoveImage from './components/MoveImage';
import SelectionBtns from './components/SelectionBtns';

const Board = () => (
  <>
    <Canvas />
    <CursorBroadcaster />
    <CursorLayer />
    <MoveImage />
    <SelectionBtns />
  </>
);

export default Board;
