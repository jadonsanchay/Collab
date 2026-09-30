import { describe, expect, it } from 'vitest';

import { fitWithin } from './resizeImage';

describe('fitWithin', () => {
  it('scales the long edge down to the limit and keeps the aspect ratio', () => {
    expect(fitWithin(4000, 2000, 1024)).toEqual({ width: 1024, height: 512, scale: 0.256 });
    expect(fitWithin(500, 2000, 1000)).toEqual({ width: 250, height: 1000, scale: 0.5 });
  });

  it('never scales up and never yields a zero dimension', () => {
    expect(fitWithin(300, 200, 1024)).toEqual({ width: 300, height: 200, scale: 1 });
    expect(fitWithin(3000, 1, 100)).toEqual({ width: 100, height: 1, scale: 100 / 3000 });
  });
});
