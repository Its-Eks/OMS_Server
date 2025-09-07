import type { Request, Response, NextFunction } from 'express';
import { logger } from '../services/logging.service.ts';

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  logger.error({
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip
  });

  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  res.status(500).json({
    success: false,
    error: {
      message: isDevelopment ? err.message : 'Internal server error',
      ...(isDevelopment && { stack: err.stack })
    }
  });
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    success: false,
    error: { message: `Route ${req.method} ${req.url} not found` }
  });
}
