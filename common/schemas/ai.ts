import { z } from 'zod';

import { MAX_IMAGE_BASE64_LENGTH, selectionSchema } from './move';

export const AI_KINDS = ['cleanup', 'draw', 'summarize'] as const;

export const aiKindSchema = z.enum(AI_KINDS);

/** A prompt is an instruction, not an essay. */
export const MAX_AI_PROMPT_LENGTH = 500;

/**
 * What a client sends to ask Sketch for something. Rectangles are in board
 * coordinates. The image is a PNG the client already resized to fit 1024
 * pixels on its long edge, base64 without a data-URL prefix.
 */
export const aiRequestSchema = z.object({
  /** Client-minted, so status updates and undo can be matched to the request. */
  requestId: z.string().uuid(),
  kind: aiKindSchema,
  prompt: z.string().max(MAX_AI_PROMPT_LENGTH).optional(),
  /** The region to redraw. Required for `cleanup`, ignored otherwise. */
  selection: selectionSchema.optional(),
  /** What the requester can currently see; where `draw` and `summarize` land. */
  viewport: selectionSchema,
  image: z.string().max(MAX_IMAGE_BASE64_LENGTH).optional(),
});

export const aiUndoSchema = z.string().uuid();

export const AI_STATUSES = [
  'queued',
  'thinking',
  'drawing',
  'done',
  'error',
  'refused',
  'rate_limited',
] as const;

export const aiStatusSchema = z.enum(AI_STATUSES);

export type AiKind = z.infer<typeof aiKindSchema>;
export type AiRequest = z.infer<typeof aiRequestSchema>;
export type AiStatus = z.infer<typeof aiStatusSchema>;
/** A board-space rectangle. Width and height may be negative (drag direction). */
export type BoardRect = z.infer<typeof selectionSchema>;
