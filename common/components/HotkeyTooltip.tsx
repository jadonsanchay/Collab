import { ReactNode } from 'react';

import { Kbd } from './ui/kbd';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './ui/tooltip';

/**
 * A tooltip that names an action and, when it has one, shows the keyboard
 * shortcut for it as a `Kbd`. Wrap each toolbar button in this instead of
 * relying on the native `title` attribute, which shows no shortcut at all.
 */
const HotkeyTooltip = ({
  label,
  hotkey = undefined,
  children,
}: {
  label: string;
  hotkey?: string;
  children: ReactNode;
}) => (
  <TooltipProvider delayDuration={300}>
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>
        <span className="flex items-center gap-2">
          {label}
          {hotkey && <Kbd>{hotkey}</Kbd>}
        </span>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

export default HotkeyTooltip;
