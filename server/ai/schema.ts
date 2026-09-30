import { z } from 'zod';

/**
 * The model does not emit `Move` objects. It emits a small drawing program in
 * a 0 to 1000 coordinate space that the interpreter scales into a target
 * rectangle on the board. A tiny schema keeps the model away from pixel
 * math, and the same program can later become vector objects (Phase 4).
 */
export const PROGRAM_SPACE = 1000;

/** More than this is not a sketch, it is a payload. */
export const MAX_PRIMITIVES = 150;

const coordinate = z.number().min(0).max(PROGRAM_SPACE);
const size = z.number().min(0).max(PROGRAM_SPACE);
const strokeWidth = z.number().min(1).max(20);

export const programPointSchema = z.object({ x: coordinate, y: coordinate });

export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const primitiveSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('line'),
    points: z.array(programPointSchema).min(2).max(200),
    stroke: colorSchema,
    width: strokeWidth,
  }),
  z.object({
    type: z.literal('rect'),
    x: coordinate,
    y: coordinate,
    w: size,
    h: size,
    stroke: colorSchema,
    fill: colorSchema.nullable(),
    width: strokeWidth,
  }),
  z.object({
    type: z.literal('ellipse'),
    cx: coordinate,
    cy: coordinate,
    rx: size,
    ry: size,
    stroke: colorSchema,
    fill: colorSchema.nullable(),
    width: strokeWidth,
  }),
  z.object({
    type: z.literal('arrow'),
    from: programPointSchema,
    to: programPointSchema,
    stroke: colorSchema,
    width: strokeWidth,
  }),
  z.object({
    type: z.literal('text'),
    x: coordinate,
    y: coordinate,
    text: z.string().max(200),
    size: z.number().min(8).max(120),
    color: colorSchema,
  }),
  z.object({
    type: z.literal('sticky'),
    x: coordinate,
    y: coordinate,
    w: size,
    h: size,
    text: z.string().max(300),
    fill: colorSchema,
  }),
]);

export const drawingProgramSchema = z.object({
  primitives: z.array(primitiveSchema).max(MAX_PRIMITIVES),
  /** One line Sketch posts in chat when it is done. */
  note: z.string().max(300).optional(),
});

export type DrawingProgram = z.infer<typeof drawingProgramSchema>;
export type Primitive = z.infer<typeof primitiveSchema>;
export type ProgramPoint = z.infer<typeof programPointSchema>;

/**
 * The same schema as JSON Schema, for the model's structured output and for
 * `docs/ai-teammate.md`. One definition validates and documents.
 */
export const drawingProgramJsonSchema = () =>
  z.toJSONSchema(drawingProgramSchema);
