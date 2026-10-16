import type { User } from '@/common/types/global';

/**
 * How a member is shown on the board: the name alone, or "Name (handle)"
 * when someone else in the room has the same name and this person has a
 * handle to tell them apart with. Guests never show a handle.
 */
export const displayName = (userId: string, users: Map<string, User>, fallback = 'Anonymous'): string => {
  const user = users.get(userId);

  if (!user) return fallback;

  const name = user.name || fallback;
  const lower = name.toLowerCase();
  let shared = false;

  users.forEach((other, otherId) => {
    if (otherId !== userId && other.name.toLowerCase() === lower) shared = true;
  });

  return shared && user.username ? `${name} (${user.username})` : name;
};
