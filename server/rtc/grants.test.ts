import { TrackSource } from 'livekit-server-sdk';
import { describe, expect, it } from 'vitest';

import { boardIdFromRoomName, grantsFor, rtcRoomName } from './grants';

describe('LiveKit grants by role', () => {
  it('lets owners and editors publish everything and subscribe', () => {
    (['owner', 'editor'] as const).forEach((role) => {
      expect(grantsFor(role, 'abcdefgh')).toEqual({
        roomJoin: true,
        room: 'board:abcdefgh',
        canSubscribe: true,
        canPublish: true,
        canPublishData: false,
      });
    });
  });

  it('limits commenters to a microphone', () => {
    expect(grantsFor('commenter', 'abcdefgh')).toMatchObject({
      canPublish: true,
      canPublishSources: [TrackSource.MICROPHONE],
    });
  });

  it('lets viewers only subscribe, and refuses non-members', () => {
    expect(grantsFor('viewer', 'abcdefgh')).toMatchObject({ canPublish: false, canSubscribe: true });
    expect(grantsFor('none', 'abcdefgh')).toBeNull();
  });

  it('never grants data channels', () => {
    (['owner', 'editor', 'commenter', 'viewer'] as const).forEach((role) => {
      expect(grantsFor(role, 'x')?.canPublishData).toBe(false);
    });
  });

  it('maps room names to board ids and back', () => {
    expect(rtcRoomName('abcdefgh')).toBe('board:abcdefgh');
    expect(boardIdFromRoomName('board:abcdefgh')).toBe('abcdefgh');
    expect(boardIdFromRoomName('other')).toBeNull();
  });
});
