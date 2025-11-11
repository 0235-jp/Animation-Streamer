import { Router } from 'express';
import { StreamController } from './controllers/stream.controller';

export function createStreamRouter(controller: StreamController): Router {
  const router = Router();
  router.post('/start', controller.start);
  router.post('/stop', controller.stop);
  router.post('/text', controller.text);
  router.get('/status', controller.status);
  return router;
}
