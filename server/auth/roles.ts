import { isAiUser } from '@/common/constants/ai';
import type { Role } from '@/common/constants/roles';

import type { BoardStore } from '../boards/BoardStore';

/**
 * Answers "what may this user do on this board". Every mutating socket
 * handler and every board API route asks it.
 */
export interface RoleResolver {
  roleFor(roomId: string, userId: string): Promise<Role>;
  /** Forget cached answers after a membership change. */
  invalidate(roomId: string, userId?: string): void;
}

/**
 * Memory mode: the creator owns the board and everyone who can find it may
 * draw, exactly as before Phase 3. Sketch is always allowed to draw.
 */
export class MemoryRoleResolver implements RoleResolver {
  constructor(private store: BoardStore) {}

  async roleFor(roomId: string, userId: string): Promise<Role> {
    if (isAiUser(userId)) return 'editor';

    const room = this.store.get(roomId);

    if (!room) return 'none';

    return room.ownerId === userId ? 'owner' : 'editor';
  }

  /** Nothing is cached in memory mode. */
  // eslint-disable-next-line class-methods-use-this -- interface method with nothing to forget
  invalidate() {}
}
