import type { Request, Response } from 'express';
import { AuthService } from '../services/auth.service.ts';
import { pgPool } from '../config/database.config.ts';
import { redis } from '../config/redis.config.ts';

// Create AuthService instance
const authService = new AuthService(pgPool, redis);

// Unified login endpoint
export async function loginUser(req: Request, res: Response) {
  try {
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
      
      return res.json({ 
        success: true, 
        data: { 
          user, 
          ...tokens 
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
      
      return res.json({ 
        success: true, 
        data: { 
          user, 
          ...tokens 
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

// POST /api/auth/google
export async function googleAuth(req: Request, res: Response) {
  try {
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
  if (!req.user) {
    return res.status(401).json({ 
      success: false, 
      error: { message: 'Not authenticated' } 
    });
  }
  
  res.json({ 
    success: true, 
    data: req.user 
  });
}