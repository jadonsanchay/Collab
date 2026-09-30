import Canvas from './components/Canvas';
import CursorBroadcaster from './components/CursorBroadcaster';
import CursorLayer from './components/CursorLayer';
import MoveImage from './components/MoveImage';
import SelectionBar from './components/SelectionBar';
import TextInput from './components/TextInput';

const Board = () => (
  <>
    <Canvas />
    <CursorBroadcaster />
    <CursorLayer />
    <MoveImage />
    <SelectionBar />
    <TextInput />
  </>
);

export default Board;
