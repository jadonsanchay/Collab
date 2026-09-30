import type { AiKind } from '@/common/types/global';

import type { DrawingProgram } from './schema';

export type AgentInput = {
  kind: AiKind;
  prompt?: string;
  /** Base64 PNG, no data-URL prefix. The selection for cleanup, the viewport otherwise. */
  imageBase64?: string;
  /** Recent chat lines, oldest first, for `summarize`. */
  recentChat?: string[];
};

export type AgentUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
};

export type AgentResult =
  | { status: 'ok'; program: DrawingProgram; usage?: AgentUsage }
  | { status: 'refused'; message: string }
  | { status: 'error'; message: string };

/**
 * Anything that can turn a request into a drawing program. The Anthropic
 * implementation is the real one; the fake returns fixed programs so the rest
 * of the pipeline can be exercised without a key or a network.
 */
export interface SketchAgent {
  readonly name: string;
  generate(input: AgentInput, signal: AbortSignal): Promise<AgentResult>;
}
