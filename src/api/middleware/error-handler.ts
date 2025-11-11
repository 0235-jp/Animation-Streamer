import type { Request, Response, NextFunction } from 'express';
import type { Logger } from 'pino';

interface HttpError extends Error {
  status?: number;
}

export function createErrorHandler(logger: Logger) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (err: HttpError, _req: Request, res: Response, _next: NextFunction): void => {
    const statusCode = err.status ?? 500;
    if (statusCode >= 500) {
      logger.error({ err }, 'Unhandled error');
    }
    res.status(statusCode).json({ message: err.message ?? 'Internal Server Error' });
  };
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ message: 'Not Found' });
}
