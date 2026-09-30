import { CANVAS_SIZE } from '@/common/constants/canvasSize';
import type { DrawPayload } from '@/common/types/global';

import { interpret } from '../ai/interpreter';
import type { DrawingProgram, Primitive } from '../ai/schema';

export type Template = {
  id: string;
  name: string;
  description: string;
  program: DrawingProgram;
};

const INK = '#1F2937';
const MUTED = '#6B7280';

/** Three labelled columns spanning the program space, for retro and kanban boards. */
const columns = (titles: string[], fills: string[]): Primitive[] => {
  const gap = 30;
  const width = (920 - gap * (titles.length - 1)) / titles.length;

  return titles.flatMap((title, index): Primitive[] => {
    const x = 40 + index * (width + gap);

    return [
      { type: 'rect', x, y: 140, w: width, h: 800, stroke: INK, fill: fills[index], width: 3 },
      { type: 'text', x: x + 20, y: 160, text: title, size: 34, color: INK },
      {
        type: 'line',
        points: [
          { x: x + 20, y: 215 },
          { x: x + width - 20, y: 215 },
        ],
        stroke: MUTED,
        width: 2,
      },
    ];
  });
};

/**
 * Starting points for a new board, authored as drawing programs and
 * interpreted onto the board like Sketch's output. They stay raster moves
 * until Phase 4 turns templates into object documents.
 */
export const TEMPLATES: Template[] = [
  {
    id: 'blank',
    name: 'Blank board',
    description: 'An empty 4000 by 2000 canvas.',
    program: { primitives: [] },
  },
  {
    id: 'retro',
    name: 'Retrospective',
    description: 'Went well, to improve, action items.',
    program: {
      primitives: [
        { type: 'text', x: 40, y: 50, text: 'Retrospective', size: 56, color: INK },
        ...columns(['Went well', 'To improve', 'Action items'], ['#DCFCE7', '#FEF3C7', '#DBEAFE']),
      ],
    },
  },
  {
    id: 'kanban',
    name: 'Kanban',
    description: 'To do, doing, done.',
    program: {
      primitives: [
        { type: 'text', x: 40, y: 50, text: 'Kanban', size: 56, color: INK },
        ...columns(['To do', 'Doing', 'Done'], ['#F3F4F6', '#FEF9C3', '#DCFCE7']),
      ],
    },
  },
  {
    id: 'brainstorm',
    name: 'Brainstorm',
    description: 'A topic in the middle, ideas around it.',
    program: {
      primitives: [
        { type: 'ellipse', cx: 500, cy: 500, rx: 170, ry: 110, stroke: INK, fill: '#E0E7FF', width: 4 },
        { type: 'text', x: 440, y: 480, text: 'Topic', size: 40, color: INK },
        ...[
          [140, 120],
          [560, 90],
          [760, 320],
          [720, 700],
          [300, 760],
          [90, 480],
        ].map(
          ([x, y], index): Primitive => ({
            type: 'sticky',
            x,
            y,
            w: 200,
            h: 150,
            text: `Idea ${index + 1}`,
            fill: ['#FEF08A', '#BBF7D0', '#BFDBFE', '#FBCFE8', '#FED7AA', '#DDD6FE'][index],
          }),
        ),
        ...[
          [340, 195],
          [660, 165],
          [760, 395],
          [720, 700],
          [400, 760],
          [290, 555],
        ].map(
          ([x, y]): Primitive => ({
            type: 'arrow',
            from: { x, y },
            to: { x: 500 + (x - 500) * 0.45, y: 500 + (y - 500) * 0.45 },
            stroke: MUTED,
            width: 2,
          }),
        ),
      ],
    },
  },
  {
    id: 'swot',
    name: 'SWOT',
    description: 'Strengths, weaknesses, opportunities, threats.',
    program: {
      primitives: [
        { type: 'text', x: 40, y: 50, text: 'SWOT analysis', size: 56, color: INK },
        ...[
          ['Strengths', 40, 140, '#DCFCE7'],
          ['Weaknesses', 510, 140, '#FEE2E2'],
          ['Opportunities', 40, 560, '#DBEAFE'],
          ['Threats', 510, 560, '#FEF3C7'],
        ].map(([title, x, y, fill]): Primitive[] => [
          { type: 'rect', x: Number(x), y: Number(y), w: 450, h: 400, stroke: INK, fill: String(fill), width: 3 },
          { type: 'text', x: Number(x) + 20, y: Number(y) + 20, text: String(title), size: 34, color: INK },
        ]).flat(),
      ],
    },
  },
];

export const findTemplate = (id: string | undefined) =>
  TEMPLATES.find((template) => template.id === (id ?? 'blank'));

/** The template's moves, laid out across the whole board. */
export const templateMoves = (template: Template): DrawPayload[] =>
  interpret(template.program, { x: 0, y: 0, width: CANVAS_SIZE.width, height: CANVAS_SIZE.height }).map(
    (planned) => planned.payload,
  );

/** What the client needs to show a picker. */
export const templateSummaries = () =>
  TEMPLATES.map(({ id, name, description }) => ({ id, name, description }));
