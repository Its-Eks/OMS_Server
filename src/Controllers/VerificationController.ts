import crypto from 'crypto';
import type { Pool } from 'pg';

export async function generateEmailVerificationToken(db: Pool, userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  await db.query(
    `INSERT INTO email_verification_tokens (user_id, token, expires_at, created_at)
     VALUES ($1, $2, $3, NOW())`,
    [userId, token, expiresAt]
  );

  return token;
}

export async function verifyEmailToken(db: Pool, token: string): Promise<void> {
  const result = await db.query(
    `SELECT user_id, expires_at, used_at FROM email_verification_tokens 
     WHERE token = $1`,
    [token]
  );

  if (result.rows.length === 0) {
    throw new Error('Invalid verification token');
  }

  const { user_id, expires_at, used_at } = result.rows[0];

  if (used_at) {
    throw new Error('Verification token already used');
  }

  if (new Date() > new Date(expires_at)) {
    throw new Error('Verification token expired');
  }

  // Mark token as used
  await db.query(
    `UPDATE email_verification_tokens SET used_at = NOW() WHERE token = $1`,
    [token]
  );

  // Mark user email as verified
  await db.query(
    `UPDATE users SET email_verified = true, updated_at = NOW() WHERE id = $1`,
    [user_id]
  );
}
