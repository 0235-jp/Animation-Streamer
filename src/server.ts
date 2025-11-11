import express from 'express';
import path from 'path';
import { createLogger } from './logger';
import { loadStreamProfile } from './config/loader';
import { WaitingLoopController } from './services/waiting-loop.controller';
import { StreamService } from './services/stream.service';
import { StreamController } from './api/controllers/stream.controller';
import { createStreamRouter } from './api/routes';
import { createErrorHandler, notFoundHandler } from './api/middleware/error-handler';
import { LocalMediaServer } from './infra/media-server';

async function bootstrap() {
  const logger = createLogger();
  const configPath = process.env.STREAM_PROFILE_PATH ?? path.resolve(process.cwd(), 'config/stream-profile.json');
  logger.info({ configPath }, 'Loading stream profile');
  const profile = await loadStreamProfile(configPath);

  if (process.env.ENABLE_LOCAL_MEDIA_SERVER !== 'false') {
    const mediaServer = new LocalMediaServer(logger.child({ module: 'MediaServer' }));
    mediaServer.start();
  } else {
    logger.info('Local media server disabled');
  }

  const waitingLoop = new WaitingLoopController(
    profile.waitingMotions,
    profile.rtmp.outputUrl,
    logger.child({ module: 'WaitingLoop' })
  );

  const streamService = new StreamService(waitingLoop, logger.child({ module: 'StreamService' }));
  const controller = new StreamController(streamService);

  const app = express();
  app.use(express.json());
  app.use('/api', createStreamRouter(controller));
  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  const configuredPort = profile.server?.port ?? 4000;
  const port = Number(process.env.PORT ?? configuredPort);
  app.listen(port, () => {
    logger.info({ port }, 'Animation Streamer API ready');
  });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
