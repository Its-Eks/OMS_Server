import crypto from 'crypto';
import bcrypt from 'bcrypt';
import type { Pool } from 'pg';

export async function generatePasswordResetToken(db: Pool, email: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await db.query(
    `INSERT INTO password_reset_tokens (email, token, expires_at, created_at)
     VALUES ($1, $2, $3, NOW())`,
    [email, token, expiresAt]
  );

  return token;
}

export async function resetPassword(db: Pool, token: string, newPassword: string): Promise<void> {
  const result = await db.query(
    `SELECT email, expires_at, used_at FROM password_reset_tokens 
     WHERE token = $1`,
    [token]
  );

  if (result.rows.length === 0) {
    throw new Error('Invalid reset token');
  }

  const { email, expires_at, used_at } = result.rows[0];

  if (used_at) {
    throw new Error('Reset token already used');
  }

  if (new Date() > new Date(expires_at)) {
    throw new Error('Reset token expired');
  }

  // Hash new password
  const saltRounds = 12;
  const passwordHash = await bcrypt.hash(newPassword, saltRounds);

  // Update user password
  await db.query(
    `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE email = $2`,
    [passwordHash, email]
  );

  // Mark token as used
  await db.query(
    `UPDATE password_reset_tokens SET used_at = NOW() WHERE token = $1`,
    [token]
  );
}
