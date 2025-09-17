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
    const appUrl =  process.env.APP_URL || `https://oms-server-ntlv.onrender.com/${process.env.PORT || 3000}`;
    const verifyLink = `${appUrl.replace(/\/$/, '')}/auth/verify-email-page?token=${encodeURIComponent(token)}`;

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
    let resetTokenForLink: string | undefined;
    if (userEmail) {
      try {
        const resetToken = await generatePasswordResetToken(db, userEmail);
        resetTokenForLink = resetToken;
        const appUrl = process.env.APP_URL || `https://oms-server-ntlv.onrender.com/${process.env.PORT || 3003}`;
        const setPasswordLink = `${appUrl.replace(/\/$/, '')}/auth/set-password-page?token=${encodeURIComponent(resetToken)}`;
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

    // Render celebratory HTML with confetti and optional direct link
    const directLink = resetTokenForLink ? `/auth/set-password-page?token=${encodeURIComponent(resetTokenForLink)}` : '';
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Email Verified</title>
    <style>
      body { margin:0; height:100vh; display:flex; align-items:center; justify-content:center; background:#0b1220; color:#fff; font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; }
      .card { text-align:center; padding:32px 28px; border-radius:14px; background: rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); box-shadow: 0 10px 30px rgba(0,0,0,.3); backdrop-filter: blur(6px); }
      h1 { margin:0 0 8px; font-size:24px; }
      p { margin: 8px 0 16px; color:#cdd6f4; }
      .btn { display:inline-block; margin-top:8px; padding:10px 14px; border-radius:8px; background:#22c55e; color:#0b1220; text-decoration:none; font-weight:600; }
      .muted { font-size:12px; color:#9aa4bf; margin-top:10px; }
      canvas { position:fixed; inset:0; pointer-events:none; }
    </style>
  </head>
  <body>
    <canvas id="confetti"></canvas>
    <div class="card">
      <h1>✅ Email Verified</h1>
      <p>Thanks, ${firstName}. Your email is confirmed.</p>
      ${directLink ? `<a class=\"btn\" href=\"${directLink}\">Set Password Now</a>` : ''}
      <div class="muted">This window will close automatically in 5 seconds.</div>
    </div>
    <script>
      const c = document.getElementById('confetti');
      const ctx = c.getContext('2d');
      function rs(){ c.width = innerWidth; c.height = innerHeight } rs(); addEventListener('resize', rs);
      const N = 150; const parts = Array.from({length:N},()=>({
        x: Math.random()*c.width,
        y: Math.random()*-c.height,
        r: 2+Math.random()*4,
        s: 1+Math.random()*2,
        a: Math.random()*Math.PI*2,
        c: 'hsl(' + (Math.random()*360) + ',90%,60%)'
      }));
      function tick(){
        ctx.clearRect(0,0,c.width,c.height);
        for(const p of parts){
          p.y += p.s; p.x += Math.sin(p.a+=0.03);
          if(p.y > c.height+10){ p.y = -10; p.x = Math.random()*c.width }
          ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
        }
        requestAnimationFrame(tick);
      }
      tick();
      setTimeout(()=>{ try { window.close() } catch(e) {} }, 5000);
    </script>
  </body>
</html>`);
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
  const db = req.app.get('pgPool');
  try {
    const { token, newPassword, confirm } = req.body || {};
    if (!token || !newPassword || !confirm) throw new Error('Missing fields');
    if (String(newPassword) !== String(confirm)) throw new Error('Passwords do not match');
    if (String(newPassword).length < 8) throw new Error('Password must be at least 8 characters');
    await resetPassword(db, String(token), String(newPassword));
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><html><body><h1>Password set</h1><p>Your password was updated. You can now close this window and log in.</p></body></html>`);
  } catch (error: any) {
    res.status(400).setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><html><body><h1>Could not set password</h1><p>${error.message}</p></body></html>`);
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
    const appUrl =  process.env.APP_URL || `https://oms-server-ntlv.onrender.com/${process.env.PORT || 3003}`;
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
      const appUrl =  process.env.APP_URL || `https://oms-server-ntlv.onrender.com/${process.env.PORT || 3000}`;
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
