import next from 'next';

import { createAppServer } from './app';
import { logger } from './logger';

const port = parseInt(process.env.PORT || '3000', 10);
const dev = process.env.NODE_ENV !== 'production';

const nextApp = next({ dev });
const nextHandler = nextApp.getRequestHandler();

nextApp.prepare().then(() => {
  const { server } = createAppServer({ nextHandler });

  server.listen(port, () => {
    logger.info({ port, dev }, `Ready on http://localhost:${port}`);
  });
});
