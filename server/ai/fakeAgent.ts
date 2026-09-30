import type { AiKind } from '@/common/types/global';

import type { DrawingProgram } from './schema';
import type { SketchAgent } from './types';

const INK = '#1F2937';
const PAPER = '#111827';

/**
 * Fixed programs, one per request kind, that exercise every primitive the
 * interpreter knows. Tests and `AI_FAKE=1` development use these so the
 * whole pipeline — queue, participant, animation, undo — runs with no key
 * and no network.
 */
export const fakePrograms: Record<AiKind, (prompt?: string) => DrawingProgram> = {
  cleanup: () => ({
    primitives: [
      { type: 'rect', x: 100, y: 100, w: 800, h: 600, stroke: INK, fill: null, width: 4 },
      {
        type: 'ellipse',
        cx: 500,
        cy: 400,
        rx: 220,
        ry: 140,
        stroke: '#2563EB',
        fill: '#DBEAFE',
        width: 3,
      },
      {
        type: 'line',
        points: [
          { x: 150, y: 650 },
          { x: 500, y: 700 },
          { x: 850, y: 650 },
        ],
        stroke: INK,
        width: 3,
      },
      { type: 'text', x: 120, y: 130, text: 'tidied up', size: 48, color: PAPER },
    ],
    note: 'Cleaned up your sketch.',
  }),

  draw: (prompt) => {
    const label = (prompt ?? 'a house').trim().slice(0, 40) || 'a house';

    return {
      primitives: [
        { type: 'rect', x: 250, y: 450, w: 500, h: 400, stroke: '#374151', fill: '#FDE68A', width: 4 },
        {
          type: 'line',
          points: [
            { x: 200, y: 450 },
            { x: 500, y: 200 },
            { x: 800, y: 450 },
          ],
          stroke: '#B45309',
          width: 6,
        },
        { type: 'rect', x: 450, y: 650, w: 100, h: 200, stroke: '#374151', fill: '#92400E', width: 3 },
        { type: 'text', x: 120, y: 60, text: label, size: 44, color: PAPER },
        { type: 'arrow', from: { x: 300, y: 130 }, to: { x: 450, y: 420 }, stroke: '#DC2626', width: 4 },
      ],
      note: `Here is ${label}.`,
    };
  },

  summarize: () => ({
    primitives: [
      { type: 'sticky', x: 40, y: 40, w: 280, h: 240, text: 'Key point one from the board', fill: '#FEF08A' },
      { type: 'sticky', x: 360, y: 40, w: 280, h: 240, text: 'Key point two from the chat', fill: '#BBF7D0' },
      { type: 'sticky', x: 680, y: 40, w: 280, h: 240, text: 'Next step: decide and assign', fill: '#BFDBFE' },
    ],
    note: 'Posted a summary as three stickies.',
  }),
};

export const createFakeAgent = (): SketchAgent => ({
  name: 'fake',
  generate: async (input) => ({
    status: 'ok',
    program: fakePrograms[input.kind](input.prompt),
  }),
});
