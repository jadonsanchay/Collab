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

/** A paragraph, not a document: text moves are labels and notes. */
export const MAX_TEXT_LENGTH = 2000;

/** The tool maps line width onto 12 to 64; the headroom is for scaled AI output. */
export const MAX_FONT_SIZE = 200;

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

export const shapeSchema = z.enum(['line', 'circle', 'rect', 'image', 'text']);

/** Payload of a `text` move: the anchor is `path[0]`, everything else is here. */
export const moveTextSchema = z.object({
  content: z.string().max(MAX_TEXT_LENGTH),
  fontSize: z.number().positive().max(MAX_FONT_SIZE),
});

/**
 * Server-side bookkeeping attached to a move. `requestId` groups every move
 * Sketch drew for one AI request so the whole batch can be undone at once.
 */
export const moveMetaSchema = z.object({
  requestId: z.string().optional(),
});

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
  /** Present only when `options.shape` is `text`. Optional so older payloads still parse. */
  text: moveTextSchema.optional(),
  timestamp: z.number(),
  id: z.string(),
  /**
   * Who drew it. Server-assigned from the handshake identity and kept for
   * the life of the move, including after its author leaves the room, so
   * history can always be filtered by person. Empty string before the move
   * has been through the server.
   */
  userId: z.string(),
  meta: moveMetaSchema.optional(),
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
 * What a client may send on `draw`. The server assigns `id`, `timestamp`,
 * `seq`, `userId` and `meta`; omitting them here means a client cannot forge
 * any of them, since `z.object` strips unknown keys. `clientId` is the
 * exception: it has to come from the client, because it is what makes a retry
 * recognisable.
 */
export const drawPayloadSchema = moveSchema
  .omit({ id: true, timestamp: true, seq: true, userId: true, meta: true })
  .extend({ clientId: z.string().uuid() });

export type Shape = z.infer<typeof shapeSchema>;
export type CtxMode = z.infer<typeof ctxModeSchema>;
export type CtxOptions = z.infer<typeof ctxOptionsSchema>;
export type Move = z.infer<typeof moveSchema>;
export type MoveText = z.infer<typeof moveTextSchema>;
export type MoveMeta = z.infer<typeof moveMetaSchema>;
export type DrawPayload = z.infer<typeof drawPayloadSchema>;
export type Point = z.infer<typeof pointSchema>;
