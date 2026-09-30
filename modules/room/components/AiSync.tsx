import { useAiSync } from '../hooks/useAiSync';

/** Mounts the `ai_status` listener once per room. Renders nothing. */
const AiSync = () => {
  useAiSync();

  return null;
};

export default AiSync;
