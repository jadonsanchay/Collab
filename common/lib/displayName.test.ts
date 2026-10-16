import { describe, expect, it } from 'vitest';

import type { User } from '@/common/types/global';

import { displayName } from './displayName';

describe('displayName', () => {
  const users = new Map<string, User>([
    ['a', { name: 'Alex', username: 'quiet_amber_otter', color: '#000' }],
    ['b', { name: 'alex', username: 'bold_lunar_fox', color: '#111' }],
    ['c', { name: 'Alex', color: '#222' }],
    ['d', { name: 'Sam', username: 'spry_wise_wren', color: '#333' }],
  ]);

  it('adds the handle only when another member shares the name', () => {
    expect(displayName('a', users)).toBe('Alex (quiet_amber_otter)');
    expect(displayName('b', users)).toBe('alex (bold_lunar_fox)');
    expect(displayName('d', users)).toBe('Sam');
  });

  it('leaves a guest with a shared name as the bare name, and falls back for strangers', () => {
    expect(displayName('c', users)).toBe('Alex');
    expect(displayName('zzz', users)).toBe('Anonymous');
  });
});
