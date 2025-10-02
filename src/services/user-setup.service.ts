import crypto from 'crypto';
import bcrypt from 'bcrypt';
import type { Pool } from 'pg';

export interface SetupTokenInfo {
  token: string;
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  emailVerified: boolean;
  passwordSet: boolean;
  completedAt: Date | null;
  isExpired: boolean;
}

export class UserSetupService {
  
  /**
   * Generate a non-expiring setup token for new user onboarding
   */
  static async generateSetupToken(db: Pool, userId: string): Promise<string> {
    const token = crypto.randomBytes(32).toString('hex');
    
    await db.query(
      `INSERT INTO user_setup_tokens (user_id, token, created_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET 
         token = EXCLUDED.token,
         created_at = NOW()`,
      [userId, token]
    );
    
    return token;
  }
  
  /**
   * Get setup token information
   */
  static async getSetupToken(db: Pool, token: string): Promise<SetupTokenInfo | null> {
    const result = await db.query(`
      SELECT 
        ust.token,
        ust.user_id,
        ust.email_verified,
        ust.password_set,
        ust.completed_at,
        u.email,
        u.first_name,
        u.last_name,
        u.email_verified as user_email_verified,
        u.password_hash,
        u.setup_completed
      FROM user_setup_tokens ust
      JOIN users u ON u.id = ust.user_id
      WHERE ust.token = $1
    `, [token]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    const row = result.rows[0];
    const emailVerified = row.email_verified || row.user_email_verified;
    const passwordSet = row.password_set || !!row.password_hash;
    const completedAt = row.completed_at;
    
    // Token is only expired if setup is completed (both email verified AND password set)
    const isExpired = !!(completedAt && emailVerified && passwordSet);
    
    return {
      token: row.token,
      userId: row.user_id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      emailVerified,
      passwordSet,
      completedAt,
      isExpired
    };
  }
  
  /**
   * Verify email using setup token
   */
  static async verifyEmail(db: Pool, token: string, ipAddress?: string, userAgent?: string): Promise<SetupTokenInfo> {
    const setupInfo = await this.getSetupToken(db, token);
    if (!setupInfo) {
      throw new Error('Invalid setup token');
    }
    
    if (setupInfo.isExpired) {
      throw new Error('Setup token has expired - account setup was already completed');
    }
    
    // Mark email as verified in both tables
    await db.query(`
      UPDATE user_setup_tokens 
      SET email_verified = true, last_used_at = NOW(), ip_address = $2, user_agent = $3
      WHERE token = $1
    `, [token, ipAddress, userAgent]);
    
    await db.query(`
      UPDATE users 
      SET email_verified = true, updated_at = NOW()
      WHERE id = $1
    `, [setupInfo.userId]);
    
    return { ...setupInfo, emailVerified: true, isExpired: false };
  }
  
  /**
   * Set password using setup token - THIS COMPLETES THE SETUP AND EXPIRES THE TOKEN
   */
  static async setPassword(db: Pool, token: string, password: string, ipAddress?: string, userAgent?: string): Promise<SetupTokenInfo> {
    const setupInfo = await this.getSetupToken(db, token);
    if (!setupInfo) {
      throw new Error('Invalid setup token');
    }
    
    if (setupInfo.isExpired) {
      throw new Error('Setup token has expired - account setup was already completed');
    }
    
    if (!setupInfo.emailVerified) {
      throw new Error('Email must be verified before setting password');
    }
    
    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    
    // Update user password
    await db.query(`
      UPDATE users 
      SET password_hash = $1, updated_at = NOW()
      WHERE id = $2
    `, [passwordHash, setupInfo.userId]);
    
    // Setup is now complete - EXPIRE THE TOKEN
    const completedAt = new Date();
    
    // Mark password as set and setup as completed in setup token
    await db.query(`
      UPDATE user_setup_tokens 
      SET 
        password_set = true, 
        completed_at = $2,
        last_used_at = NOW(), 
        ip_address = $3, 
        user_agent = $4
      WHERE token = $1
    `, [token, completedAt, ipAddress, userAgent]);
    
    // Mark user setup as completed
    await db.query(`
      UPDATE users 
      SET setup_completed = true, updated_at = NOW()
      WHERE id = $1
    `, [setupInfo.userId]);
    
    return { 
      ...setupInfo, 
      passwordSet: true, 
      completedAt,
      isExpired: true  // Token is now expired since setup is complete
    };
  }
  
  /**
   * Check if a setup token is valid and not expired
   */
  static async isTokenValid(db: Pool, token: string): Promise<boolean> {
    const setupInfo = await this.getSetupToken(db, token);
    return setupInfo !== null && !setupInfo.isExpired;
  }
  
  /**
   * Clean up old completed setup tokens (optional maintenance)
   */
  static async cleanupCompletedTokens(db: Pool, olderThanDays: number = 30): Promise<number> {
    const result = await db.query(`
      DELETE FROM user_setup_tokens 
      WHERE completed_at IS NOT NULL 
        AND completed_at < NOW() - INTERVAL '${olderThanDays} days'
    `);
    
    return result.rowCount || 0;
  }
}
