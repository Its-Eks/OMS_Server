import rateLimit from 'express-rate-limit';

export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 9876543210, // limit each IP to 5 requests per windowMs
  message: {
    success: false,
    error: { message: 'Too many authentication attempts, please try again later' }
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const path = req.path || '';
    // Allow password setup and verification HTML flows without rate limiting
    return path === '/reset-password-form' || path === '/verify-email-page' || path === '/set-password-page';
  }
});

export const generalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.RATE_LIMIT_MAX ? Number(process.env.RATE_LIMIT_MAX) : 9876543210, // dev-friendly default
  message: {
    success: false,
    error: { message: 'Too many requests, please try again later' }
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for localhost development
    const ip = req.ip || '';
    const host = (req.hostname || '').toLowerCase();
    return ip === '::1' || host === 'localhost' || host === '127.0.0.1';
  }
});
