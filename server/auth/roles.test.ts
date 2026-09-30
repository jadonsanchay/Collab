import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AI_USER_ID } from '@/common/constants/ai';

import { BoardStore } from '../boards/BoardStore';
import { DbPersistence } from '../boards/dbPersistence';
import { createShareLink, redeemShareLink, revokeShareLink } from '../boards/shareLinks';
import { createPglite, type Database } from '../db/client';
import { boardMembers, boards } from '../db/schema';
import { RoomStore } from '../rooms/RoomStore';
import { DbRoleResolver } from './dbRoles';
import { MemoryRoleResolver } from './roles';

describe('MemoryRoleResolver', () => {
  it('makes the creator owner and everyone else editor', async () => {
    const rooms = new RoomStore({ sweepIntervalMs: 60_000 });
    const store = new BoardStore(rooms);
    const owner = randomUUID();
    const { roomId } = await store.create(owner, 'Owner', 's1');
    const roles = new MemoryRoleResolver(store);

    expect(await roles.roleFor(roomId, owner)).toBe('owner');
    expect(await roles.roleFor(roomId, randomUUID())).toBe('editor');
    expect(await roles.roleFor(roomId, AI_USER_ID)).toBe('editor');
    expect(await roles.roleFor('nowhere1', owner)).toBe('none');

    rooms.stop();
  });
});

describe('DbRoleResolver and share links', () => {
  let database: Database;
  let rooms: RoomStore;
  let store: BoardStore;
  let roles: DbRoleResolver;
  let roomId: string;
  const owner = randomUUID();
  const stranger = randomUUID();

  beforeAll(async () => {
    database = await createPglite();
    rooms = new RoomStore({ sweepIntervalMs: 60_000 });
    const persistence = new DbPersistence(database, { flushMs: 5 });
    store = new BoardStore(rooms, persistence);
    roles = new DbRoleResolver(database.db, store);

    ({ roomId } = await store.create(owner, 'Owner', 's1'));
  }, 60_000);

  afterAll(async () => {
    rooms.stop();
    await database.close();
  });

  it('gives the owner ownership and strangers the link role on a link board', async () => {
    expect(await roles.roleFor(roomId, owner)).toBe('owner');
    expect(await roles.roleFor(roomId, stranger)).toBe('editor');
    expect(await roles.roleFor(roomId, AI_USER_ID)).toBe('editor');
  });

  it('follows visibility and link role changes once the cache is dropped', async () => {
    await database.db
      .update(boards)
      .set({ visibility: 'link', linkRole: 'viewer' })
      .where(eq(boards.id, roomId));

    // Cached from the previous test until invalidated.
    expect(await roles.roleFor(roomId, stranger)).toBe('editor');
    roles.invalidate(roomId);
    expect(await roles.roleFor(roomId, stranger)).toBe('viewer');

    await database.db.update(boards).set({ visibility: 'private' }).where(eq(boards.id, roomId));
    roles.invalidate(roomId, stranger);
    expect(await roles.roleFor(roomId, stranger)).toBe('none');
    expect(await roles.roleFor(roomId, owner)).toBe('owner');
  });

  it('turns a share link into a membership, never downgrading, and honours revocation and expiry', async () => {
    const editorLink = await createShareLink(database.db, { boardId: roomId, role: 'editor', createdBy: owner });
    const viewerLink = await createShareLink(database.db, { boardId: roomId, role: 'viewer', createdBy: owner });

    const redeemed = await redeemShareLink(database.db, roles, editorLink.token, {
      userId: stranger,
      name: 'Stranger',
    });

    expect(redeemed).toEqual({ status: 'ok', boardId: roomId, role: 'editor' });
    expect(await roles.roleFor(roomId, stranger)).toBe('editor');

    // A viewer link does not take the editor role away.
    expect(
      await redeemShareLink(database.db, roles, viewerLink.token, { userId: stranger, name: null }),
    ).toEqual({ status: 'ok', boardId: roomId, role: 'editor' });

    expect(await revokeShareLink(database.db, roomId, viewerLink.token)).toBe(true);
    expect(await revokeShareLink(database.db, roomId, viewerLink.token)).toBe(false);
    expect(
      await redeemShareLink(database.db, roles, viewerLink.token, { userId: randomUUID(), name: null }),
    ).toEqual({ status: 'revoked' });

    const expired = await createShareLink(database.db, {
      boardId: roomId,
      role: 'viewer',
      createdBy: owner,
      expiresInHours: 1,
    });
    await database.db
      .update(boardMembers)
      .set({ role: 'viewer' })
      .where(eq(boardMembers.userId, 'nobody'));
    // Force expiry by rewinding the stored timestamp.
    await database.db.execute(
      `update share_links set expires_at = now() - interval '1 hour' where token = '${expired.token}'`,
    );

    expect(
      await redeemShareLink(database.db, roles, expired.token, { userId: randomUUID(), name: null }),
    ).toEqual({ status: 'expired' });
    expect(
      await redeemShareLink(database.db, roles, 'not-a-token', { userId: randomUUID(), name: null }),
    ).toEqual({ status: 'invalid' });
  });
});
