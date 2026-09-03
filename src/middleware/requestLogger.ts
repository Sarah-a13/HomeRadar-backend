import { Request, Response, NextFunction } from 'express';

// Lightweight request/response logger: method, path, status, response time.
// Avoids logging request/response bodies (may contain passwords/tokens).
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms`);
  });
  next();
}
