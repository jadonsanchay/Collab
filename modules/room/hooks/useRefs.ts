import { useContext } from 'react';

import { roomContext } from '../context/Room.context';

export const useRefs = () => {
  const {
    undoRef,
    bgRef,
    canvasRef,
    liveRef,
    remoteLiveRef,
    minimapRef,
    redoRef,
    selectionRefs,
  } = useContext(roomContext);

  return {
    undoRef,
    redoRef,
    bgRef,
    canvasRef,
    liveRef,
    remoteLiveRef,
    minimapRef,
    selectionRefs,
  };
};
