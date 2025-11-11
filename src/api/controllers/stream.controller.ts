import type { Request, Response, NextFunction } from 'express';
import { StreamService } from '../../services/stream.service';

export class StreamController {
  constructor(private readonly streamService: StreamService) {}

  start = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const payload = await this.streamService.startWaiting();
      res.json(payload);
    } catch (err) {
      next(err);
    }
  };

  stop = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const payload = await this.streamService.stop();
      res.json(payload);
    } catch (err) {
      next(err);
    }
  };

  status = (_req: Request, res: Response): void => {
    res.json(this.streamService.getStatus());
  };

  text = (_req: Request, res: Response): void => {
    res.status(501).json({ message: 'text endpoint is not implemented yet' });
  };
}
