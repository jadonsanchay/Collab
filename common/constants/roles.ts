/**
 * What a member may do on a board. `none` is not a member at all: on a
 * private board that means no entry. Ranked so "at least editor" is a
 * comparison rather than a list.
 */
export const ROLES = ['owner', 'editor', 'commenter', 'viewer', 'none'] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_RANK: Record<Role, number> = {
  none: 0,
  viewer: 1,
  commenter: 2,
  editor: 3,
  owner: 4,
};

export const atLeast = (role: Role, floor: Role) => ROLE_RANK[role] >= ROLE_RANK[floor];

/** Draw, undo, place images, ask Sketch. */
export const canDraw = (role: Role) => atLeast(role, 'editor');

/** Send chat messages. */
export const canChat = (role: Role) => atLeast(role, 'commenter');

/** Rename, share, change visibility, delete. */
export const canManage = (role: Role) => role === 'owner';

/** Enter the board at all. */
export const canView = (role: Role) => atLeast(role, 'viewer');

/** Roles a share link or a link-visibility board may grant. */
export const GRANTABLE_ROLES = ['editor', 'commenter', 'viewer'] as const;

export type GrantableRole = (typeof GRANTABLE_ROLES)[number];
