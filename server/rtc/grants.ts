import { TrackSource, type VideoGrant } from 'livekit-server-sdk';

import type { Role } from '@/common/constants/roles';

/** One LiveKit room per board, named so a room name maps back to a board id. */
export const rtcRoomName = (boardId: string) => `board:${boardId}`;

export const boardIdFromRoomName = (room: string): string | null =>
  room.startsWith('board:') ? room.slice('board:'.length) : null;

/**
 * Board roles as LiveKit grants. Owners and editors publish anything;
 * commenters publish only a microphone; viewers listen and watch. Data
 * channels are off for everyone: Socket.IO already carries every ephemeral
 * event, and one transport per concern is the rule. Null for `none`: not a
 * member, no token.
 */
export const grantsFor = (role: Role, boardId: string): VideoGrant | null => {
  const room = rtcRoomName(boardId);

  switch (role) {
    case 'owner':
    case 'editor':
      return { roomJoin: true, room, canSubscribe: true, canPublish: true, canPublishData: false };

    case 'commenter':
      return {
        roomJoin: true,
        room,
        canSubscribe: true,
        canPublish: true,
        canPublishSources: [TrackSource.MICROPHONE],
        canPublishData: false,
      };

    case 'viewer':
      return { roomJoin: true, room, canSubscribe: true, canPublish: false, canPublishData: false };

    default:
      return null;
  }
};
