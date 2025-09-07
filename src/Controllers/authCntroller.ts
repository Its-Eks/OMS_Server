// auth.service.ts
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import admin from 'firebase-admin';
import { Pool } from 'pg';
import Redis from 'ioredis';

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    }),
  });
}

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: {
    name: string;
    permissions: string[];
  };
  firebaseUid?: string;
  loginMethod: 'email' | 'google';
  emailVerified: boolean;
  profilePictureUrl?: string;
}

interface JWTPayload {
  userId: string;
  email: string;
  role: string;
  permissions: string[];
  iat: number;
  exp: number;
  tokenType: 'access' | 'refresh';
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export class AuthService {
  private db: Pool;
  private redis: Redis;

  constructor(db: Pool, redis: Redis) {
    this.db = db;
    this.redis = redis;
  }

  // Google OAuth authentication with Firebase
  async authenticateWithGoogle(firebaseToken: string, deviceInfo?: any, ipAddress?: string): Promise<{ user: User; tokens: AuthTokens }> {
    try {
      // Verify Firebase ID token
      const decodedToken = await admin.auth().verifyIdToken(firebaseToken);

      if (!decodedToken.email || !decodedToken.email_verified) {
        throw new Error('Email not verified or missing');
      }

      // Restrict allowed domains
      const allowedDomains = ['xnext.co.za', 'mooya.co.za'];
      const emailDomain = decodedToken.email.split('@')[1]?.toLowerCase();
      if (!emailDomain || !allowedDomains.includes(emailDomain)) {
        throw new Error('Only Xnext.co.za and Mooya.co.za email domains are allowed.');
      }

      // Check if user exists
      let user = await this.findUserByFirebaseUid(decodedToken.uid);

      if (!user) {
        // Check if user exists with same email but no Firebase UID
        const existingUser = await this.findUserByEmail(decodedToken.email);

        if (existingUser) {
          // Link Firebase account to existing user
          user = await this.linkFirebaseAccount(existingUser.id, decodedToken);
        } else {
          // Create new user from Google account
          user = await this.createUserFromGoogle(decodedToken);
        }
      } else {
        // Update last login
        await this.updateLastLogin(user.id);
      }

      // Generate JWT tokens
      const tokens = await this.generateTokens(user, deviceInfo, ipAddress);

      return { user, tokens };
    } catch (error) {
      throw new Error(`Google authentication failed: ${error.message}`);
    }
  }

  // Email/password authentication is disabled. Only Google SSO is allowed.
  async authenticateWithEmail(): Promise<never> {
    throw new Error('Email/password authentication is disabled. Please use Google SSO with an allowed domain.');
  }
// Export controller functions for routes
export const SignInWithEmailAndPassword = async (req, res) => {
  res.status(403).json({ error: 'Email/password authentication is disabled. Please use Google SSO with an allowed domain.' });
};

export const SignInWithGoogle = async (req, res) => {
  const { firebaseToken } = req.body;
  try {
    const authService = req.app.get('authService');
    const { user, tokens } = await authService.authenticateWithGoogle(firebaseToken, req.body.deviceInfo, req.ip);
    res.json({ user, tokens });
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
};

export const SignUpWithEmailAndPassword = async (req, res) => {
  res.status(403).json({ error: 'Sign up with email/password is disabled. Please use Google SSO.' });
};

export const SignOut = async (req, res) => {
  const { refreshToken, accessToken } = req.body;
  try {
    const authService = req.app.get('authService');
    await authService.logout(refreshToken, accessToken);
    res.json({ message: 'Signed out successfully' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

  // Generate access and refresh tokens
  private async generateTokens(user: User, deviceInfo?: any, ipAddress?: string): Promise<AuthTokens> {
    const accessTokenPayload: Omit<JWTPayload, 'iat' | 'exp' | 'tokenType'> = {
      userId: user.id,
      email: user.email,
      role: user.role.name,
      permissions: user.role.permissions,
    };

    const accessToken = jwt.sign(
      { ...accessTokenPayload, tokenType: 'access' },
      process.env.JWT_SECRET!,
      { 
        expiresIn: process.env.JWT_EXPIRES_IN || '15m',
        issuer: 'isp-oms',
        audience: 'isp-oms-users'
      }
    );

    const refreshToken = jwt.sign(
      { ...accessTokenPayload, tokenType: 'refresh' },
      process.env.JWT_REFRESH_SECRET!,
      { 
        expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
        issuer: 'isp-oms',
        audience: 'isp-oms-users'
      }
    );

    // Store refresh token in database
    const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, device_info, ip_address) 
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, refreshTokenHash, expiresAt, JSON.stringify(deviceInfo), ipAddress]
    );

    // Store session in Redis for quick access
    await this.redis.setex(
      `session:${user.id}`,
      3600, // 1 hour
      JSON.stringify({
        userId: user.id,
        email: user.email,
        role: user.role.name,
        permissions: user.role.permissions,
        lastActivity: Date.now()
      })
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: 15 * 60 // 15 minutes
    };
  }

  // Refresh access token
  async refreshAccessToken(refreshToken: string): Promise<AuthTokens> {
    try {
      // Verify refresh token
      const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) as JWTPayload;
      
      if (decoded.tokenType !== 'refresh') {
        throw new Error('Invalid token type');
      }

      // Check if refresh token exists and is not revoked
      const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      const tokenResult = await this.db.query(
        'SELECT * FROM refresh_tokens WHERE token_hash = $1 AND is_revoked = false AND expires_at > CURRENT_TIMESTAMP',
        [refreshTokenHash]
      );

      if (tokenResult.rows.length === 0) {
        throw new Error('Refresh token not found or expired');
      }

      // Get user details
      const user = await this.findUserById(decoded.userId);
      if (!user || !user.isActive) {
        throw new Error('User not found or inactive');
      }

      // Generate new access token
      const accessToken = jwt.sign(
        {
          userId: user.id,
          email: user.email,
          role: user.role.name,
          permissions: user.role.permissions,
          tokenType: 'access'
        },
        process.env.JWT_SECRET!,
        { 
          expiresIn: process.env.JWT_EXPIRES_IN || '15m',
          issuer: 'isp-oms',
          audience: 'isp-oms-users'
        }
      );

      return {
        accessToken,
        refreshToken, // Keep the same refresh token
        expiresIn: 15 * 60
      };
    } catch (error) {
      throw new Error(`Token refresh failed: ${error.message}`);
    }
  }

  // Logout user
  async logout(refreshToken: string, accessToken?: string): Promise<void> {
    try {
      // Revoke refresh token
      const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      await this.db.query(
        'UPDATE refresh_tokens SET is_revoked = true WHERE token_hash = $1',
        [refreshTokenHash]
      );

      // Blacklist access token if provided
      if (accessToken) {
        const accessTokenHash = crypto.createHash('sha256').update(accessToken).digest('hex');
        const decoded = jwt.decode(accessToken) as any;
        const expiresAt = new Date(decoded.exp * 1000);

        await this.db.query(
          'INSERT INTO blacklisted_tokens (token_hash, expires_at, reason) VALUES ($1, $2, $3)',
          [accessTokenHash, expiresAt, 'user_logout']
        );
      }

      // Get user ID from refresh token and remove session
      const decoded = jwt.decode(refreshToken) as any;
      if (decoded && decoded.userId) {
        await this.redis.del(`session:${decoded.userId}`);
      }
    } catch (error) {
      throw new Error(`Logout failed: ${error.message}`);
    }
  }

  // Verify access token
  async verifyAccessToken(token: string): Promise<User> {
    try {
      // Check if token is blacklisted
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const blacklistedResult = await this.db.query(
        'SELECT id FROM blacklisted_tokens WHERE token_hash = $1 AND expires_at > CURRENT_TIMESTAMP',
        [tokenHash]
      );

      if (blacklistedResult.rows.length > 0) {
        throw new Error('Token has been revoked');
      }

      // Verify JWT
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JWTPayload;
      
      if (decoded.tokenType !== 'access') {
        throw new Error('Invalid token type');
      }

      // Get user details
      const user = await this.findUserById(decoded.userId);
      if (!user || !user.isActive) {
        throw new Error('User not found or inactive');
      }

      return user;
    } catch (error) {
      throw new Error(`Token verification failed: ${error.message}`);
    }
  }

  // Helper methods
  private async findUserByEmail(email: string): Promise<any> {
    const result = await this.db.query(`
      SELECT u.*, r.name as role_name, r.permissions, u.password_hash
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE u.email = $1 AND u.is_active = true
    `, [email]);

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      firebaseUid: row.firebase_uid,
      loginMethod: row.login_method,
      emailVerified: row.email_verified,
      profilePictureUrl: row.profile_picture_url,
      isActive: row.is_active,
      passwordHash: row.password_hash,
      role: {
        name: row.role_name,
        permissions: row.permissions
      }
    };
  }

  private async findUserByFirebaseUid(firebaseUid: string): Promise<User | null> {
    const result = await this.db.query(`
      SELECT u.*, r.name as role_name, r.permissions
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE u.firebase_uid = $1 AND u.is_active = true
    `, [firebaseUid]);

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      firebaseUid: row.firebase_uid,
      loginMethod: row.login_method,
      emailVerified: row.email_verified,
      profilePictureUrl: row.profile_picture_url,
      role: {
        name: row.role_name,
        permissions: row.permissions
      }
    };
  }

  private async findUserById(userId: string): Promise<User | null> {
    const result = await this.db.query(`
      SELECT u.*, r.name as role_name, r.permissions
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE u.id = $1 AND u.is_active = true
    `, [userId]);

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      firebaseUid: row.firebase_uid,
      loginMethod: row.login_method,
      emailVerified: row.email_verified,
      profilePictureUrl: row.profile_picture_url,
      role: {
        name: row.role_name,
        permissions: row.permissions
      }
    };
  }

  private async linkFirebaseAccount(userId: string, decodedToken: any): Promise<User> {
    await this.db.query(`
      UPDATE users 
      SET firebase_uid = $1, 
          email_verified = $2, 
          profile_picture_url = $3,
          login_method = 'google',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
    `, [decodedToken.uid, true, decodedToken.picture, userId]);

    return await this.findUserById(userId);
  }

  private async createUserFromGoogle(decodedToken: any): Promise<User> {
    // Get default role (sales_representative or based on email domain)
    const defaultRoleResult = await this.db.query(
      "SELECT id FROM roles WHERE name = 'sales_representative'"
    );

    if (defaultRoleResult.rows.length === 0) {
      throw new Error('Default role not found');
    }

    const result = await this.db.query(`
      INSERT INTO users (
        firebase_uid, email, first_name, last_name, role_id, 
        email_verified, profile_picture_url, login_method
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, [
      decodedToken.uid,
      decodedToken.email,
      decodedToken.name?.split(' ')[0] || 'User',
      decodedToken.name?.split(' ').slice(1).join(' ') || '',
      defaultRoleResult.rows[0].id,
      true,
      decodedToken.picture,
      'google'
    ]);

    return await this.findUserById(result.rows[0].id);
  }

  private async updateLastLogin(userId: string): Promise<void> {
    await this.db.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
      [userId]
    );
  }

  // Cleanup expired tokens (run periodically)
  async cleanupExpiredTokens(): Promise<void> {
    await this.db.query('SELECT cleanup_expired_tokens()');
  }
}