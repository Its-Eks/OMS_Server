import { Router } from 'express';
import { authenticate, authorize } from '../Middleware/authMiddleware.ts';
import { registerUser } from '../Controllers/RegisterController.ts';
import { generateEmailVerificationToken, verifyEmailToken } from '../Controllers/VerificationController.ts';
import { generatePasswordResetToken, resetPassword } from '../Controllers/PasswordResetController.ts';
import { NotificationService } from '../services/notification.service.ts';
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
    
    // Generate non-expiring setup token instead of verification token
    const { UserSetupService } = await import('../services/user-setup.service.ts');
    const setupToken = await UserSetupService.generateSetupToken(db, userId);
    
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3003';
    const clientUrl = process.env.APP_URL || `https://oms-client-01ry.onrender.com`;
    const setupLink = `${backendUrl}/auth/setup?token=${encodeURIComponent(setupToken)}`;

    let emailPreviewUrl: string | undefined;
    try {
      // Look up user details for email
      const result = await db.query('SELECT email, first_name, last_name FROM users WHERE id = $1', [userId]);
      const userInfo = result.rows[0];
      const toEmail = userInfo?.email as string;
      const firstName = userInfo?.first_name || 'there';
      
      // Improved welcome email template
      const emailHtml = `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e9ecef;">
          <div style="background: #000; padding: 40px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 28px;">Welcome to OMS</h1>
            <p style="color: #f8f9fa; margin: 15px 0 0 0; font-size: 16px;">Your account is ready to be activated</p>
          </div>
          <div style="padding: 40px;">
            <p style="font-size: 18px; color: #333; margin-bottom: 25px;">Hi ${firstName},</p>
            
            <p style="color: #555; line-height: 1.6; margin-bottom: 25px;">
              Your OMS account has been created! To get started, please click the link below to verify your email and set up your password.
            </p>
            
            <div style="text-align: center; margin: 35px 0;">
              <a href="${setupLink}" style="background: #000; color: white; padding: 15px 30px; text-decoration: none; border-radius: 4px; font-weight: 500; display: inline-block;">
                Complete Account Setup
              </a>
            </div>
            
            <div style="background: #f8f9fa; border-left: 4px solid #000; padding: 20px; margin: 25px 0; border-radius: 0 4px 4px 0;">
              <h3 style="margin: 0 0 10px 0; color: #333; font-size: 16px;">What happens next:</h3>
              <ol style="color: #555; margin: 10px 0; padding-left: 20px; line-height: 1.8;">
                <li>Click the setup link above</li>
                <li>Verify your email address</li>
                <li>Create your secure password</li>
                <li>Access the OMS platform</li>
              </ol>
            </div>
            
            <p style="color: #666; font-size: 14px; margin-top: 30px;">
              <strong>Note:</strong> This setup link does not expire, so you can complete your account setup at your convenience.
            </p>
            
            <p style="color: #666; font-size: 14px;">
              If you did not expect this email or need assistance, please contact your system administrator.
            </p>
          </div>
        </div>
      `;

      const { sendEmail } = await import('../services/notification.service.ts');
      const resultSend = await sendEmail({
        to: toEmail,
        subject: 'Welcome to OMS - Complete Your Account Setup',
        html: emailHtml
      });
      emailPreviewUrl = (resultSend as any)?.previewUrl;
    } catch (mailError) {
      // Do not fail user creation if email sending fails
      console.warn('Failed to send setup email:', mailError);
    }

    const responseBody: any = { 
      success: true, 
      userId, 
      setupToken,
      message: 'User created successfully! Setup email sent to user.'
    };
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
    // Find user email and generate a one-time password setup token, then redirect to set-password page (no email sent)
    const userRes = await db.query(
      `SELECT u.email
       FROM email_verification_tokens evt
       JOIN users u ON u.id = evt.user_id
       WHERE evt.token = $1`,
      [token]
    );
    const userEmail = userRes.rows[0]?.email as string;
    if (!userEmail) throw new Error('User not found for token');
        const resetToken = await generatePasswordResetToken(db, userEmail);
    return res.redirect(302, `/auth/set-password-page?token=${encodeURIComponent(resetToken)}`);
  } catch (error: any) {
    res.status(400).json({ success: false, error: { message: error.message } });
  }
});

// HTML flow: verify and render password setup form
router.get('/verify-email-page', async (req, res) => {
  const db = req.app.get('pgPool');
  try {
    const { token } = req.query;
    if (!token || typeof token !== 'string') throw new Error('Token required');
    await verifyEmailToken(db, token);

    // Generate a one-time password setup token
    const userRes = await db.query(
      `SELECT u.email, u.first_name
       FROM email_verification_tokens evt
       JOIN users u ON u.id = evt.user_id
       WHERE evt.token = $1`,
      [token]
    );
    const userEmail = userRes.rows[0]?.email as string;
    if (!userEmail) throw new Error('User not found for token');
    const resetToken = await generatePasswordResetToken(db, userEmail);

    // Render a simple HTML form that posts to /auth/reset-password-form
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Set Your Password</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; padding: 40px; }
      .card { max-width: 420px; margin: 0 auto; border: 1px solid #ddd; border-radius: 8px; padding: 24px; }
      h1 { font-size: 20px; margin: 0 0 12px; }
      input { width: 100%; padding: 10px; margin: 8px 0; border: 1px solid #ccc; border-radius: 6px; }
      button { width: 100%; padding: 10px; background: #0d6efd; color: #fff; border: 0; border-radius: 6px; cursor: pointer; }
      button:disabled { opacity: .6; cursor: not-allowed; }
      .muted { color: #666; font-size: 13px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Set Your Password</h1>
      <form method="POST" action="/auth/reset-password-form">
        <input type="hidden" name="token" value="${resetToken}" />
        <label>New password</label>
        <input type="password" name="newPassword" required minlength="8" />
        <label>Confirm password</label>
        <input type="password" name="confirm" required minlength="8" />
        <button type="submit">Set Password</button>
      </form>
      <p class="muted">Password must be at least 8 characters.</p>
    </div>
  </body>
 </html>`);
  } catch (error: any) {
    res.status(400).setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><html><body><h1>Verification failed</h1><p>${error.message}</p></body></html>`);
  }
});


// HTML form handler for password setup
router.post('/reset-password-form', async (req, res) => {
  try {
    const db = req.app.get('pgPool');
    const { token, newPassword, confirm } = req.body || {};
    if (!token || !newPassword || !confirm) throw new Error('Missing fields');
    if (String(newPassword) !== String(confirm)) throw new Error('Passwords do not match');
    if (String(newPassword).length < 8) throw new Error('Password must be at least 8 characters');
    await resetPassword(db, String(token), String(newPassword));
    // Redirect to client app after success
    return res.redirect(302, 'https://oms-client-x2nv.vercel.app');
  } catch (error: any) {
    res.status(400).setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><html><body><h1>Could not set password</h1><p>${error.message}</p></body></html>`);
  }
});

// Ensure any errors on the HTML form path return HTML instead of JSON
import type { Request, Response, NextFunction } from 'express';
router.use('/reset-password-form', (err: any, req: Request, res: Response, _next: NextFunction) => {
  try {
    const message = (err && err.message) ? String(err.message) : 'Unable to set password';
    res.status(400).setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><html><body><h1>Could not set password</h1><p>${message}</p></body></html>`);
  } catch {
    res.status(400).setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><html><body><h1>Could not set password</h1><p>Unexpected error</p></body></html>`);
  }
});

// HTML page that renders a password form from token in query (for direct email link)
router.get('/set-password-page', async (req, res) => {
  const { token } = req.query;
  if (!token || typeof token !== 'string') {
    res.status(400).setHeader('Content-Type', 'text/html');
    return res.end(`<!doctype html><html><body><h1>Missing token</h1><p>Please use the link from your email.</p></body></html>`);
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Set Your Password</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; padding: 40px; }
      .card { max-width: 420px; margin: 0 auto; border: 1px solid #ddd; border-radius: 8px; padding: 24px; }
      h1 { font-size: 20px; margin: 0 0 12px; }
      input { width: 100%; padding: 10px; margin: 8px 0; border: 1px solid #ccc; border-radius: 6px; }
      button { width: 100%; padding: 10px; background: #0d6efd; color: #fff; border: 0; border-radius: 6px; cursor: pointer; }
      button:disabled { opacity: .6; cursor: not-allowed; }
      .muted { color: #666; font-size: 13px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Set Your Password</h1>
      <form method="POST" action="/auth/reset-password-form">
        <input type="hidden" name="token" value="${token}" />
        <label>New password</label>
        <input type="password" name="newPassword" required minlength="8" />
        <label>Confirm password</label>
        <input type="password" name="confirm" required minlength="8" />
        <button type="submit">Set Password</button>
      </form>
      <p class="muted">Password must be at least 8 characters.</p>
    </div>
  </body>
 </html>`);
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
    const appUrl =  process.env.APP_URL || `https://oms-server-ntlv.onrender.com/`;
    const verifyLink = `${appUrl}/verify-email?token=${encodeURIComponent(token)}`;

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
      const appUrl =  process.env.APP_URL || `https://oms-server-ntlv.onrender.com/`;
    const resetLink = `${appUrl}/reset-password?token=${encodeURIComponent(token)}`;

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

// Hook: notify password link expired (call this when frontend detects expiry on load)
router.post('/password-link-expired', async (req, res) => {
  try {
    const { userId, email } = req.body || {};
    const mongo = req.app.get('mongoClient');
    if (mongo && userId) {
      const notif = new NotificationService(mongo);
      await notif.emitEvent({ type: 'password_link_expired', userId: String(userId), metadata: { email } });
    }
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: { message: e.message } });
  }
});

// Example protected route
router.get('/profile', authenticate, (req, res) => {
  res.json({ success: true, user: (req as any).user });
});

export default router;
