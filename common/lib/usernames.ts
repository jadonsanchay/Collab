import { USERNAME_PATTERN } from '@/common/schemas/auth';

/** Short words only: two adjectives, a noun and two underscores must fit in 24 characters. */
const ADJECTIVES = [
  'amber', 'bold', 'brave', 'brisk', 'calm', 'civil', 'clear', 'cool', 'cosmic', 'crisp',
  'daring', 'deep', 'eager', 'early', 'fair', 'fancy', 'fast', 'fierce', 'fond', 'free',
  'fresh', 'gentle', 'glad', 'golden', 'grand', 'happy', 'hardy', 'humble', 'jolly', 'keen',
  'kind', 'lively', 'lucky', 'lunar', 'mellow', 'merry', 'mighty', 'misty', 'neat', 'noble',
  'odd', 'plucky', 'proud', 'quick', 'quiet', 'rapid', 'rare', 'ready', 'royal', 'sharp',
  'shy', 'silent', 'sleek', 'smart', 'snug', 'solar', 'spry', 'steady', 'sunny', 'swift',
  'tidy', 'vivid', 'warm', 'wild', 'wise', 'witty', 'young', 'zesty',
];

const NOUNS = [
  'badger', 'beacon', 'birch', 'bison', 'brook', 'canyon', 'cedar', 'comet', 'coral', 'crane',
  'delta', 'dune', 'eagle', 'ember', 'falcon', 'fern', 'finch', 'fjord', 'fox', 'gecko',
  'glade', 'harbor', 'heron', 'iris', 'jaguar', 'kestrel', 'koala', 'lark', 'lemur', 'lotus',
  'lynx', 'maple', 'marten', 'meadow', 'moose', 'newt', 'oak', 'orca', 'otter', 'owl',
  'panda', 'pebble', 'pine', 'plover', 'poppy', 'puffin', 'quail', 'raven', 'reef', 'river',
  'robin', 'sable', 'salmon', 'sparrow', 'spruce', 'summit', 'tapir', 'thrush', 'tiger', 'trout',
  'tundra', 'vole', 'walrus', 'wren', 'yak', 'zebra',
];

const pick = <T>(list: readonly T[], random: () => number) => list[Math.floor(random() * list.length)];

/**
 * A Reddit-style handle: two adjectives and a noun, e.g. `quiet_amber_otter`.
 * Always satisfies `USERNAME_PATTERN`. The caller checks uniqueness and
 * retries; with 68 × 67 × 66 combinations a clash is rare.
 */
export const generateUsername = (random: () => number = Math.random): string => {
  const first = pick(ADJECTIVES, random);
  let second = pick(ADJECTIVES, random);

  while (second === first) second = pick(ADJECTIVES, random);

  const username = `${first}_${second}_${pick(NOUNS, random)}`;

  if (!USERNAME_PATTERN.test(username)) throw new Error(`generated an invalid username: ${username}`);

  return username;
};
