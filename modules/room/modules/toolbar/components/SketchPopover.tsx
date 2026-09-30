import { useState } from 'react';

import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import HotkeyTooltip from '@/common/components/HotkeyTooltip';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/common/components/ui/popover';
import { useFeatureFlag } from '@/common/hooks/useFeatureFlag';
import { MAX_AI_PROMPT_LENGTH } from '@/common/schemas/ai';
import { useAiStore } from '@/common/store/ai.store';

import { useRefs } from '../../../hooks/useRefs';
import { currentViewportRect, requestSketch } from '../../../lib/ai';
import { captureRegion } from '../../../lib/captureBoard';

/**
 * The toolbar entry point for Sketch: a prompt to draw from, and a one-click
 * board summary. Renders nothing unless the server has AI switched on, so a
 * deployment without a key shows no trace of the feature.
 */
const SketchPopover = () => {
  const enabled = useFeatureFlag('ai');
  const open = useAiStore((state) => state.promptOpen);
  const setOpen = useAiStore((state) => state.setPromptOpen);
  const { canvasRef, bgRef } = useRefs();

  const [prompt, setPrompt] = useState('');

  if (!enabled) return null;

  /** What the requester currently sees, for context. Null if it cannot be made. */
  const captureView = () =>
    canvasRef.current
      ? captureRegion(canvasRef.current, bgRef.current, currentViewportRect())
      : null;

  const draw = () => {
    const text = prompt.trim();

    if (!text) return;

    requestSketch('draw', { prompt: text, image: captureView() ?? undefined });
    setPrompt('');
    setOpen(false);
    toast('Sketch is on it.');
  };

  const summarize = () => {
    requestSketch('summarize', { image: captureView() ?? undefined });
    setOpen(false);
    toast('Sketch is reading the board.');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <HotkeyTooltip label="Ask Sketch">
        <PopoverTrigger asChild>
          <button type="button" className="btn-icon" aria-label="Ask Sketch">
            <Sparkles />
          </button>
        </PopoverTrigger>
      </HotkeyTooltip>
      <PopoverContent className="flex w-80 flex-col gap-3">
        <label htmlFor="sketch-prompt" className="flex flex-col gap-1">
          <span className="text-sm font-semibold">Ask Sketch to draw</span>
          <textarea
            id="sketch-prompt"
            className="rounded-md border border-zinc-300 p-2 text-sm"
            rows={3}
            maxLength={MAX_AI_PROMPT_LENGTH}
            placeholder="a flowchart of the signup steps"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                draw();
              }
            }}
          />
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
            disabled={!prompt.trim()}
            onClick={draw}
          >
            Draw
          </button>
          <button
            type="button"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm"
            onClick={summarize}
          >
            Summarize board
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default SketchPopover;
