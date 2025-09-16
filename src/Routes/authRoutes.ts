import { Router } from 'express';
import { authenticate, authorize } from '../Middleware/authMiddleware.ts';
import { registerUser } from '../Controllers/RegisterController.ts';
import { generateEmailVerificationToken, verifyEmailToken } from '../Controllers/VerificationController.ts';
import { generatePasswordResetToken, resetPassword } from '../Controllers/PasswordResetController.ts';
import { loginUser } from '../Controllers/auth.controller.ts';
import { googleAuth } from '../Controllers/auth.controller.ts';
import { refreshToken, logout, setPassword } from '../Controllers/auth.controller.ts';
import cookieParser from 'cookie-parser';
import { sendEmail } from '../services/notification.service.ts';

const router = Router();
router.use(cookieParser());

// Admin-only registration endpoint
router.post('/register', authenticate, authorize(['admin:manage_users']), async (req, res) => {
  const db = req.app.get('pgPool');
  const redis = req.app.get('redis');
  try {
    const userId = await registerUser(db, redis, req.body);
    // Generate verification token and send email
    const token = await generateEmailVerificationToken(db, userId);
    const appUrl = process.env.FRONTEND_URL || process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
    const verifyLink = `${appUrl.replace(/\/$/, '')}/verify-email?token=${encodeURIComponent(token)}`;

    let emailPreviewUrl: string | undefined;
    try {
      // Look up email to send to
      const result = await db.query('SELECT email, first_name FROM users WHERE id = $1', [userId]);
      const toEmail = result.rows[0]?.email as string;
      const firstName = (result.rows[0]?.first_name as string) || 'there';
      const emailHtml = [
        `<p>Hi ${firstName},</p>`,
        `<p>Welcome to OMS. Please verify your email address by clicking the link below:</p>`,
        `<p><a href="${verifyLink}">Verify my email</a></p>`,
        `<p>This link will expire in 24 hours. If you did not expect this email, you can ignore it.</p>`
      ].join('\n');

      const resultSend = await sendEmail({
        to: toEmail,
        subject: 'Verify your email to activate your OMS account',
        html: emailHtml
      });
      emailPreviewUrl = (resultSend as any)?.previewUrl;
    } catch (mailError) {
      // Do not fail user creation if email sending fails
      console.warn('Failed to send verification email:', mailError);
    }

    const responseBody: any = { success: true, userId, verificationToken: token };
    if (emailPreviewUrl && process.env.NODE_ENV !== 'production') {
      responseBody.emailPreviewUrl = emailPreviewUrl;
    }
    res.status(201).json(responseBody);
  } catch (error: any) {
    res.status(400).json({ success: false, error: { message: error.message } });
  }
});

// Unified login endpoint
router.post('/login', loginUser);

//0auth route
router.post('/google-login', googleAuth);

// Token refresh + logout
router.post('/refresh', refreshToken);
router.post('/logout', logout);

// Set password (for users without password)
router.post('/set-password', authenticate, setPassword);

// Email verification endpoint
router.get('/verify-email', async (req, res) => {
  const db = req.app.get('pgPool');
  try {
    const { token } = req.query;
    if (!token || typeof token !== 'string') throw new Error('Token required');
    await verifyEmailToken(db, token);
    // Find user email from token
    const userRes = await db.query(
      `SELECT u.email, u.first_name
       FROM email_verification_tokens evt
       JOIN users u ON u.id = evt.user_id
       WHERE evt.token = $1`,
      [token]
    );
    const userEmail = userRes.rows[0]?.email as string;
    const firstName = (userRes.rows[0]?.first_name as string) || 'there';

    // Generate a password setup token and email it
    if (userEmail) {
      try {
        const resetToken = await generatePasswordResetToken(db, userEmail);
        const appUrl = process.env.FRONTEND_URL || process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
        const setPasswordLink = `${appUrl.replace(/\/$/, '')}/set-password?token=${encodeURIComponent(resetToken)}`;
        const passwordSetupHtml = [
          `<p>Hi ${firstName},</p>`,
          `<p>Your email has been verified successfully. Please set your password using the link below:</p>`,
          `<p><a href="${setPasswordLink}">Set my password</a></p>`,
          `<p>This link will expire in 1 hour.</p>`
        ].join('\n');

        await sendEmail({
          to: userEmail,
          subject: 'Set your OMS account password',
          html: passwordSetupHtml
        });
      } catch (mailError) {
        console.warn('Failed to send password setup email:', mailError);
      }
    }

    res.json({ success: true, message: 'Email verified' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { message: error.message } });
  }
});

// Resend verification endpoint
router.post('/resend-verification', async (req, res) => {
  const db = req.app.get('pgPool');
  try {
    const { email } = req.body;
    const result = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) throw new Error('User not found');
    const userId = result.rows[0].id;
    const token = await generateEmailVerificationToken(db, userId);
    const appUrl = process.env.FRONTEND_URL || process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
    const verifyLink = `${appUrl.replace(/\/$/, '')}/verify-email?token=${encodeURIComponent(token)}`;

    try {
      const resendHtml = [
        `<p>Please verify your email address by clicking the link below:</p>`,
        `<p><a href="${verifyLink}">Verify my email</a></p>`,
        `<p>This link will expire in 24 hours.</p>`
      ].join('\n');

      await sendEmail({
        to: email,
        subject: 'Verify your email to activate your OMS account',
        html: resendHtml
      });
    } catch (mailError) {
      console.warn('Failed to send verification email:', mailError);
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { message: error.message } });
  }
});

// Password reset request
router.post('/forgot-password', async (req, res) => {
  const db = req.app.get('pgPool');
  try {
    const { email } = req.body;
    const token = await generatePasswordResetToken(db, email);
    const appUrl = process.env.FRONTEND_URL || process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
    const resetLink = `${appUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;

    try {
      const resetHtml = [
        `<p>We received a request to reset your password.</p>`,
        `<p><a href="${resetLink}">Reset my password</a></p>`,
        `<p>If you did not request this, you can safely ignore this email.</p>`
      ].join('\n');

      await sendEmail({
        to: email,
        subject: 'Reset your OMS account password',
        html: resetHtml
      });
    } catch (mailError) {
      console.warn('Failed to send reset email:', mailError);
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(200).json({ success: true }); // Always return success for security
  }
});

// Password reset
router.post('/reset-password', async (req, res) => {
  const db = req.app.get('pgPool');
  try {
    const { token, newPassword } = req.body;
    await resetPassword(db, token, newPassword);
    res.json({ success: true, message: 'Password reset successful' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { message: error.message } });
  }
});

// Example protected route
router.get('/profile', authenticate, (req, res) => {
  res.json({ success: true, user: (req as any).user });
});

export default router;
