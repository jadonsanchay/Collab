import next from 'next';

import { createAppServer } from './app';
import { loadConfig } from './config';
import { logger } from './logger';

// Parsed once, up front: a typo in a deploy variable should fail here rather
// than become a NaN inside a timer an hour later.
const config = loadConfig();

const port = config.PORT;
const dev = config.NODE_ENV !== 'production';

const nextApp = next({ dev });
const nextHandler = nextApp.getRequestHandler();

nextApp.prepare().then(() => {
  const { server } = createAppServer({ nextHandler, config });

  server.listen(port, () => {
    logger.info({ port, dev }, `Ready on http://localhost:${port}`);
  });
});
