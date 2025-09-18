import type { Request, Response, NextFunction } from 'express';

function toSnakeCase(str: string): string {
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase();
}

function transformKeysToSnakeCase(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(transformKeysToSnakeCase);
  }
  if (value && typeof value === 'object') {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    Object.keys(input).forEach((key) => {
      const snakeKey = toSnakeCase(key);
      output[snakeKey] = transformKeysToSnakeCase(input[key]);
    });
    return output;
  }
  return value;
}

export function normalizeBodyToSnakeCase(req: Request, _res: Response, next: NextFunction) {
  if (req.body && typeof req.body === 'object') {
    req.body = transformKeysToSnakeCase(req.body) as any;
  }
  next();
}


