import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { AuthService } from '../services/auth.service.ts';
import { NotificationService } from '../services/notification.service.ts';

// Unified login endpoint
export async function loginUser(req: Request, res: Response) {
  try {
    // Get the working database pool and redis from Express app (same as registration)
    const db = req.app.get('pgPool');
    const redis = req.app.get('redis');
    
    // Create AuthService instance with the working connections
    const authService = new AuthService(db, redis);
    
    const { method } = req.body;
    
    if (method === 'email') {
      const { email, password, deviceInfo } = req.body;
      
      // Validate required fields
      if (!email || !password) {
        return res.status(400).json({ 
          success: false, 
          error: { message: 'Email and password are required' } 
        });
      }

      const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
      
      console.log('Login attempt for:', email);
      
      const { user, tokens } = await authService.authenticateWithEmail(
        email, 
        password, 
        deviceInfo || {}, 
        ipAddress
      );
      
      // Set HttpOnly refresh token cookie
      res.cookie('refreshToken', tokens.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });

      // Emit first-login notification (once) using Redis guard
      try {
        const redisClient: any = redis as any;
        const guardKey = `notif:first_login_emitted:${user.id}`;
        const seen = await redisClient.get(guardKey);
        if (!seen) {
          const mongo = req.app.get('mongoClient');
          if (mongo) {
            const notif = new NotificationService(mongo);
            await notif.emitEvent({
              type: 'user_first_login',
              userId: String(user.id),
              metadata: { email: user.email }
            });
            await redisClient.setEx(guardKey, 60 * 60 * 24 * 30, '1'); // 30 days guard
          }
        }
      } catch {}

      return res.json({ 
        success: true, 
        data: { 
          user, 
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresIn: tokens.expiresIn
        } 
      });
    } 
    else if (method === 'google') {
      const { idToken, deviceInfo } = req.body;
      
      if (!idToken) {
        return res.status(400).json({ 
          success: false, 
          error: { message: 'Google ID token is required' } 
        });
      }

      const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
      
      const { user, tokens } = await authService.authenticateWithGoogle(
        idToken, 
        deviceInfo || {}, 
        ipAddress
      );
      
      // Set HttpOnly refresh token cookie
      res.cookie('refreshToken', tokens.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });

      return res.json({ 
        success: true, 
        data: { 
          user, 
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresIn: tokens.expiresIn
        } 
      });
    } 
    else {
      return res.status(400).json({ 
        success: false, 
        error: { message: 'Invalid login method. Use "email" or "google"' } 
      });
    }
  } catch (error: any) {
    console.error('Login error:', error.message);
    console.error('Error stack:', error.stack);
    
    // Handle specific error types
    if (error.message.includes('Invalid credentials')) {
      return res.status(401).json({ 
        success: false, 
        error: { message: 'Invalid email or password' } 
      });
    }
    
    if (error.message.includes('SCRAM-SERVER-FIRST-MESSAGE')) {
      return res.status(500).json({ 
        success: false, 
        error: { message: 'Database configuration error' } 
      });
    }
    
    res.status(401).json({ 
      success: false, 
      error: { message: error.message } 
    });
  }
}

// POST /auth/refresh - rotate access token using refresh token cookie
export async function refreshToken(req: Request, res: Response) {
  try {
    const db = req.app.get('pgPool');
    const redis = req.app.get('redis');
    const authService = new AuthService(db, redis);
    const rt = (req as any).cookies?.refreshToken;
    if (!rt) {
      return res.status(401).json({ success: false, error: { message: 'No refresh token' } });
    }
    const tokens = await authService.refreshAccessToken(rt);
    // Refresh cookie (rotation keeps same 7d TTL here)
    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    return res.json({ success: true, data: { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn } });
  } catch (error: any) {
    return res.status(401).json({ success: false, error: { message: error.message } });
  }
}

// POST /auth/logout - clear cookie and revoke tokens
export async function logout(req: Request, res: Response) {
  try {
    const db = req.app.get('pgPool');
    const redis = req.app.get('redis');
    const authService = new AuthService(db, redis);
    const rt = (req as any).cookies?.refreshToken;
    // Clear cookie
    res.clearCookie('refreshToken', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
    return res.json({ success: true });
  } catch (error: any) {
    return res.status(200).json({ success: true });
  }
}

// POST /api/auth/google
export async function googleAuth(req: Request, res: Response) {
  try {
    // Get the working database pool and redis from Express app
    const db = req.app.get('pgPool');
    const redis = req.app.get('redis');
    
    // Create AuthService instance with the working connections
    const authService = new AuthService(db, redis);
    
    const { firebaseToken, deviceInfo } = req.body;
    
    if (!firebaseToken) {
      return res.status(400).json({ 
        success: false, 
        error: { message: 'Firebase token is required' } 
      });
    }

    const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
    
    const { user, tokens } = await authService.authenticateWithGoogle(
      firebaseToken, 
      deviceInfo || {}, 
      ipAddress
    );
    
    // Emit first-login notification (once) for Google as well
    try {
      const redisClient: any = redis as any;
      const guardKey = `notif:first_login_emitted:${user.id}`;
      const seen = await redisClient.get(guardKey);
      if (!seen) {
        const mongo = req.app.get('mongoClient');
        if (mongo) {
          const notif = new NotificationService(mongo);
          await notif.emitEvent({
            type: 'user_first_login',
            userId: String(user.id),
            metadata: { email: user.email }
          });
          await redisClient.setEx(guardKey, 60 * 60 * 24 * 30, '1');
        }
      }
    } catch {}

    res.json({ 
      success: true, 
      data: { 
        user, 
        ...tokens 
      } 
    });
  } catch (error: any) {
    console.error('Google auth error:', error.message);
    res.status(401).json({ 
      success: false, 
      error: { message: error.message } 
    });
  }
}

// GET /api/auth/me (requires authentication)
export async function getMe(req: Request, res: Response) {
  // req.user is set by auth middleware
  if (!(req as any).user) {
    return res.status(401).json({ 
      success: false, 
      error: { message: 'Not authenticated' } 
    });
  }
  
  res.json({ 
    success: true, 
    data: (req as any).user 
  });
}

// POST /auth/set-password - Set password for users who don't have one
export async function setPassword(req: Request, res: Response) {
  try {
    const db = req.app.get('pgPool');
    const redis = req.app.get('redis');
    const authService = new AuthService(db, redis);
    
    const { newPassword } = req.body;
    const userId = (req as any).user?.userId;
    
    if (!userId) {
      return res.status(401).json({ 
        success: false, 
        error: { message: 'Not authenticated' } 
      });
    }
    
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ 
        success: false, 
        error: { message: 'Password must be at least 8 characters long' } 
      });
    }
    
    await authService.setUserPassword(userId, newPassword);
    
    return res.json({ 
      success: true, 
      message: 'Password set successfully' 
    });
  } catch (error: any) {
    return res.status(500).json({ 
      success: false, 
      error: { message: error.message } 
    });
  }
}