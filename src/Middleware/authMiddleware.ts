import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';

interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email: string;
    role: string;
    permissions: string[];
  };
}

export async function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: { message: 'No token provided' } });
    }

    const token = authHeader.substring(7);
    const jwtSecret = process.env.JWT_SECRET!;
    
    // Verify token
    const decoded = jwt.verify(token, jwtSecret) as any;
    
    // Check if token is blacklisted in Redis
    const redis: Redis = req.app.get('redis');
    const isBlacklisted = await redis.get(`blacklist:${token}`);
    if (isBlacklisted) {
      return res.status(401).json({ success: false, error: { message: 'Token has been revoked' } });
    }

    // Attach user info to request
    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
      permissions: decoded.permissions || []
    };

    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: { message: 'Token expired' } });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, error: { message: 'Invalid token' } });
    }
    return res.status(500).json({ success: false, error: { message: 'Authentication error' } });
  }
}

export function authorize(permissions: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: { message: 'Not authenticated' } });
    }

    const hasPermission = permissions.some(permission => 
      req.user!.permissions.includes(permission)
    );

    if (!hasPermission) {
      return res.status(403).json({ success: false, error: { message: 'Insufficient permissions' } });
    }

    next();
  };
}
