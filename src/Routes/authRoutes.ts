import { Router } from 'express';
import { authenticate, authorize } from '../Middleware/authMiddleware.ts';
import { registerUser } from '../Controllers/RegisterController.ts';
import { generateEmailVerificationToken, verifyEmailToken } from '../Controllers/VerificationController.ts';
import { generatePasswordResetToken, resetPassword } from '../Controllers/PasswordResetController.ts';
import { loginUser } from '../Controllers/auth.controller.ts';

const router = Router();

// Registration endpoint
router.post('/register', async (req, res) => {
  const db = req.app.get('pgPool');
  const redis = req.app.get('redis');
  try {
    const userId = await registerUser(db, redis, req.body);
    // Generate verification token
    const token = await generateEmailVerificationToken(db, userId);
    // TODO: Send email with token (implement email service)
    res.status(201).json({ success: true, userId, verificationToken: token });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { message: error.message } });
  }
});

// Unified login endpoint
router.post('/login', loginUser);

// Email verification endpoint
router.get('/verify-email', async (req, res) => {
  const db = req.app.get('pgPool');
  try {
    const { token } = req.query;
    if (!token || typeof token !== 'string') throw new Error('Token required');
    await verifyEmailToken(db, token);
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
    // TODO: Send email with token
    res.json({ success: true, verificationToken: token });
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
    // TODO: Send email with token
    res.json({ success: true, resetToken: token });
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
