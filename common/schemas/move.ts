import { z } from 'zod';

/**
 * A stroke longer than this is not a hand-drawn line, it is a payload. The
 * cap is generous: a slow careful stroke across the whole canvas lands in the
 * low hundreds of points.
 */
export const MAX_PATH_POINTS = 5000;

/** ~1.5 MB of base64, which is roughly a 1.1 MB image. */
export const MAX_IMAGE_BASE64_LENGTH = 1_500_000;

/** The toolbar slider offers 1 to 20; the extra headroom is deliberate. */
export const MAX_LINE_WIDTH = 100;

// Zod 4's `z.number()` already rejects NaN and Infinity, so coordinates need
// no explicit finiteness check. They are otherwise unbounded on purpose:
// panning puts legitimate strokes outside the canvas rectangle, and a wrong
// bound here would silently drop real drawing.
const coordinate = z.number();

export const pointSchema = z.tuple([coordinate, coordinate]);

export const rgbaColorSchema = z.object({
  // Not `.int()`: a colour picker that ever emits 254.9 would otherwise make
  // strokes vanish, and non-integer channels are harmless.
  r: z.number().min(0).max(255),
  g: z.number().min(0).max(255),
  b: z.number().min(0).max(255),
  a: z.number().min(0).max(1),
});

export const shapeSchema = z.enum(['line', 'circle', 'rect', 'image']);

export const ctxModeSchema = z.enum(['eraser', 'draw', 'select']);

export const selectionSchema = z.object({
  x: coordinate,
  y: coordinate,
  width: coordinate,
  height: coordinate,
});

export const ctxOptionsSchema = z.object({
  lineWidth: z.number().positive().max(MAX_LINE_WIDTH),
  lineColor: rgbaColorSchema,
  fillColor: rgbaColorSchema,
  shape: shapeSchema,
  mode: ctxModeSchema,
  selection: selectionSchema.nullable(),
});

export const moveSchema = z.object({
  circle: z.object({
    cX: coordinate,
    cY: coordinate,
    radiusX: coordinate,
    radiusY: coordinate,
  }),
  rect: z.object({
    // Negative dimensions are normal: they mean the drag went up or left.
    width: coordinate,
    height: coordinate,
  }),
  img: z.object({ base64: z.string().max(MAX_IMAGE_BASE64_LENGTH) }),
  path: z.array(pointSchema).max(MAX_PATH_POINTS),
  options: ctxOptionsSchema,
  timestamp: z.number(),
  id: z.string(),
  /**
   * Server-assigned, monotonic within a room. Clients order by this instead of
   * by `timestamp`, which came from `Date.now()` on whichever machine drew and
   * so could order overlapping strokes differently on different screens. Zero
   * means the move has not been through the server yet.
   */
  seq: z.number().int().nonnegative(),
  /**
   * Client-generated, so a move resent after a flaky delivery is recognised
   * rather than drawn twice.
   */
  clientId: z.string(),
});

/**
 * What a client may send on `draw`. The server assigns `id`, `timestamp` and
 * `seq`; omitting them here means a client cannot forge any of them, since
 * `z.object` strips unknown keys. `clientId` is the exception: it has to come
 * from the client, because it is what makes a retry recognisable.
 */
export const drawPayloadSchema = moveSchema
  .omit({ id: true, timestamp: true, seq: true })
  .extend({ clientId: z.string().uuid() });

export type Shape = z.infer<typeof shapeSchema>;
export type CtxMode = z.infer<typeof ctxModeSchema>;
export type CtxOptions = z.infer<typeof ctxOptionsSchema>;
export type Move = z.infer<typeof moveSchema>;
export type DrawPayload = z.infer<typeof drawPayloadSchema>;
