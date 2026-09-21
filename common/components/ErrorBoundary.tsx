import { Component, ErrorInfo, ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Catches a render crash in the board and offers a way out.
 *
 * Without this, one thrown error in the canvas tree unmounts the whole room and
 * leaves a blank page, which in a live session looks identical to the server
 * going away. A reload is a real fix here because nothing is stored on the
 * client: the room snapshot is re-fetched on join.
 */
class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);

    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    /* eslint-disable-next-line no-console -- the browser console is the only
       sink available on the client; remote error reporting arrives in Phase 5. */
    console.error('Board crashed:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    const { children } = this.props;

    if (!error) return children;

    return (
      <div className="flex size-full flex-col items-center justify-center gap-4 p-10 text-center">
        <h2 className="text-2xl font-bold">The board stopped responding.</h2>
        <p className="max-w-md text-zinc-500">
          Reloading rejoins the room and restores the drawing from the server.
        </p>
        <button
          className="btn"
          type="button"
          onClick={() => window.location.reload()}
        >
          Reload board
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
