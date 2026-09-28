import { createContext, ReactNode, useContext } from 'react';

import { useToolbarActions } from '../hooks/useToolbarActions';

type ToolbarActions = ReturnType<typeof useToolbarActions>;

const ToolbarActionsContext = createContext<ToolbarActions | null>(null);

/**
 * Mounted once, so `useImageInput`'s paste listener (inside
 * `useToolbarActions`) never registers twice — both the toolbar and the
 * command palette read from this single instance instead of each calling
 * `useToolbarActions` themselves.
 */
export const ToolbarActionsProvider = ({ children }: { children: ReactNode }) => {
  const actions = useToolbarActions();

  return (
    <ToolbarActionsContext.Provider value={actions}>
      {children}
    </ToolbarActionsContext.Provider>
  );
};

export const useToolbarActionsContext = () => {
  const context = useContext(ToolbarActionsContext);

  if (!context) {
    throw new Error(
      'useToolbarActionsContext must be used within a ToolbarActionsProvider',
    );
  }

  return context;
};
