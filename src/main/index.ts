import { app } from 'electron';

import { createLogger } from '#pkg/logger/create-logger.ts';

const logger = createLogger('main');

app.once('ready', () => {
  logger.info('beuve started', {
    electron: process.versions.electron,
    node: process.versions.node,
  });
  app.quit();
});
