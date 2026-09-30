import { and, eq, isNull } from 'drizzle-orm';

import { isAiUser } from '@/common/constants/ai';
import { GRANTABLE_ROLES, type Role, ROLE_RANK } from '@/common/constants/roles';

import type { BoardStore } from '../boards/BoardStore';
import type { Db } from '../db/client';
import { boardMembers, boards } from '../db/schema';
import type { RoleResolver } from './roles';

const CACHE_MS = 30_000;

/**
 * Database mode: a membership row is the answer; without one, the board's
 * visibility decides (`link` grants its link role to anyone with the id,
 * `private` grants nothing). Answers are cached for thirty seconds and
 * dropped when a membership changes.
 */
export class DbRoleResolver implements RoleResolver {
  private cache = new Map<string, { role: Role; until: number }>();

  constructor(
    private db: Db,
    private store: BoardStore,
  ) {}

  async roleFor(roomId: string, userId: string): Promise<Role> {
    if (isAiUser(userId)) return 'editor';

    const key = `${roomId}:${userId}`;
    const cached = this.cache.get(key);

    if (cached && cached.until > Date.now()) return cached.role;

    const role = await this.lookup(roomId, userId);

    this.cache.set(key, { role, until: Date.now() + CACHE_MS });

    return role;
  }

  invalidate(roomId: string, userId?: string) {
    if (userId) {
      this.cache.delete(`${roomId}:${userId}`);
      return;
    }

    [...this.cache.keys()]
      .filter((key) => key.startsWith(`${roomId}:`))
      .forEach((key) => this.cache.delete(key));
  }

  private async lookup(roomId: string, userId: string): Promise<Role> {
    const [membership] = await this.db
      .select({ role: boardMembers.role })
      .from(boardMembers)
      .where(and(eq(boardMembers.boardId, roomId), eq(boardMembers.userId, userId)));

    if (membership && membership.role in ROLE_RANK) return membership.role as Role;

    const [board] = await this.db
      .select({ visibility: boards.visibility, linkRole: boards.linkRole, ownerId: boards.ownerId })
      .from(boards)
      .where(and(eq(boards.id, roomId), isNull(boards.deletedAt)));

    if (!board) {
      // Created in memory before it was recorded, or never recorded: the
      // memory rule applies so a room never becomes unusable mid-session.
      const room = this.store.get(roomId);

      if (!room) return 'none';

      return room.ownerId === userId ? 'owner' : 'editor';
    }

    if (board.ownerId === userId) return 'owner';

    if (board.visibility === 'private') return 'none';

    return (GRANTABLE_ROLES as readonly string[]).includes(board.linkRole)
      ? (board.linkRole as Role)
      : 'viewer';
  }
}
