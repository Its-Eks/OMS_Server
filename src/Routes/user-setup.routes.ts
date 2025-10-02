import { Router } from 'express';
import { UserSetupService } from '../services/user-setup.service.ts';

const router = Router();

// New setup flow: verify email and set password in one step
router.get('/setup', async (req, res) => {
  const db = req.app.get('pgPool');
  try {
    const { token, error } = req.query;
    if (!token || typeof token !== 'string') {
      throw new Error('Setup token required');
    }
    
    const setupInfo = await UserSetupService.getSetupToken(db, token);
    
    if (!setupInfo) {
      throw new Error('Invalid setup token');
    }
    
    if (setupInfo.isExpired) {
      // Setup already completed, redirect to success page
      return res.redirect(302, `/auth/setup-complete?token=${encodeURIComponent(token)}`);
    }
    
    // Show error message if there was one
    const errorMessage = error ? decodeURIComponent(String(error)) : null;
    
    // Render setup page with email verification and password form
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Complete Your OMS Account Setup</title>
    <style>
      body { 
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
        background: #f8f9fa;
        min-height: 100vh;
        margin: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        color: #333;
      }
      .container { 
        background: white;
        max-width: 480px; 
        width: 100%;
        border-radius: 8px; 
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        border: 1px solid #e9ecef;
        overflow: hidden;
      }
      .header {
        background: #000;
        padding: 40px 30px;
        text-align: center;
        color: white;
      }
      .header h1 { margin: 0; font-size: 24px; font-weight: 600; }
      .header p { margin: 10px 0 0 0; opacity: 0.9; font-size: 16px; }
      .content { padding: 40px 30px; }
      .user-info {
        background: #f8f9fa;
        padding: 20px;
        border-radius: 4px;
        margin-bottom: 30px;
        border-left: 4px solid #000;
      }
      .user-info h3 { margin: 0 0 10px 0; color: #333; font-size: 16px; }
      .user-info p { margin: 5px 0; color: #666; }
      .form-group { margin-bottom: 20px; }
      label { display: block; margin-bottom: 8px; font-weight: 500; color: #333; }
      input[type="password"] { 
        width: 100%; 
        padding: 12px; 
        border: 1px solid #dee2e6;
        border-radius: 4px; 
        font-size: 14px;
        transition: border-color 0.3s;
        box-sizing: border-box;
      }
      input[type="password"]:focus { 
        outline: none; 
        border-color: #000; 
      }
      .password-requirements {
        font-size: 12px;
        color: #666;
        margin-top: 5px;
        line-height: 1.4;
      }
      button { 
        width: 100%; 
        padding: 12px; 
        background: #000;
        color: white; 
        border: none; 
        border-radius: 4px; 
        font-size: 16px;
        font-weight: 500;
        cursor: pointer;
        transition: background-color 0.3s;
      }
      button:hover { 
        background: #333;
      }
      button:disabled { 
        background: #6c757d; 
        cursor: not-allowed;
      }
      .status { 
        padding: 15px; 
        border-radius: 8px; 
        margin-bottom: 20px; 
        font-size: 14px;
      }
      .status.verified { background: #f8f9fa; color: #333; border-left: 4px solid #000; }
      .status.pending { background: #f8f9fa; color: #666; border-left: 4px solid #6c757d; }
      .status.error { background: #f8f9fa; color: #721c24; border-left: 4px solid #dc3545; }
      .footer { 
        text-align: center; 
        margin-top: 30px; 
        padding-top: 20px; 
        border-top: 1px solid #e1e5e9;
        color: #666; 
        font-size: 14px; 
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>Account Setup</h1>
        <p>Complete your OMS account activation</p>
      </div>
      <div class="content">
        <div class="user-info">
          <h3>Welcome, ${setupInfo.firstName} ${setupInfo.lastName}!</h3>
          <p><strong>Email:</strong> ${setupInfo.email}</p>
        </div>
        
        ${errorMessage ? `<div class="status error">❌ ${errorMessage}</div>` : ''}
        
        ${setupInfo.emailVerified 
          ? '<div class="status verified">✅ Email verified successfully</div>'
          : '<div class="status pending">📧 Email verification pending...</div>'
        }
        
        <form method="POST" action="/auth/complete-setup" id="setupForm">
          <input type="hidden" name="token" value="${token}" />
          
          ${!setupInfo.emailVerified ? `
            <div class="form-group">
              <button type="submit" name="action" value="verify_email">
                Verify Email Address
              </button>
            </div>
            <div style="text-align: center; margin: 20px 0; color: #666;">
              <em>You'll be able to set your password after verifying your email</em>
            </div>
          ` : `
            <div class="form-group">
              <label for="password">Create Your Password</label>
              <input type="password" id="password" name="password" required minlength="8" />
              <div class="password-requirements">
                Password must be at least 8 characters long
              </div>
            </div>
            
            <div class="form-group">
              <label for="confirmPassword">Confirm Password</label>
              <input type="password" id="confirmPassword" name="confirmPassword" required />
            </div>
            
            <button type="submit" name="action" value="set_password" id="submitBtn">
              Complete Setup & Access OMS
            </button>
          `}
        </form>
        
        <div class="footer">
          Need help? Contact your system administrator
        </div>
      </div>
    </div>
    
    <script>
      ${setupInfo.emailVerified ? `
      document.getElementById('confirmPassword').addEventListener('input', function() {
        const password = document.getElementById('password').value;
        const confirm = this.value;
        const submitBtn = document.getElementById('submitBtn');
        
        if (password !== confirm) {
          this.setCustomValidity('Passwords do not match');
          submitBtn.disabled = true;
        } else {
          this.setCustomValidity('');
          submitBtn.disabled = false;
        }
      });
      
      document.getElementById('password').addEventListener('input', function() {
        const confirm = document.getElementById('confirmPassword');
        if (confirm.value) {
          confirm.dispatchEvent(new Event('input'));
        }
      });
      ` : ''}
    </script>
  </body>
</html>`);
  } catch (error: any) {
    res.status(400).json({ success: false, error: { message: error.message } });
  }
});

// Handle setup form submission
router.post('/complete-setup', async (req, res) => {
  const db = req.app.get('pgPool');
  try {
    const { token, action, password, confirmPassword } = req.body;
    
    if (!token) {
      throw new Error('Setup token required');
    }
    
    const ipAddress = req.ip;
    const userAgent = req.get('User-Agent');
    
    if (action === 'verify_email') {
      // Verify email and redirect back to setup page
      await UserSetupService.verifyEmail(db, token, ipAddress, userAgent);
      return res.redirect(302, `/auth/setup?token=${encodeURIComponent(token)}`);
      
    } else if (action === 'set_password') {
      // Validate password
      if (!password || password.length < 8) {
        throw new Error('Password must be at least 8 characters long');
      }
      
      if (password !== confirmPassword) {
        throw new Error('Passwords do not match');
      }
      
      // Set password and complete setup (this expires the token)
      await UserSetupService.setPassword(db, token, password, ipAddress, userAgent);
      
      // Redirect to success page
      return res.redirect(302, `/auth/setup-complete?token=${encodeURIComponent(token)}`);
    }
    
    throw new Error('Invalid action');
    
  } catch (error: any) {
    const { token } = req.body;
    const errorMsg = encodeURIComponent(error.message);
    res.redirect(302, `/auth/setup?token=${encodeURIComponent(token || '')}&error=${errorMsg}`);
  }
});

// Setup completion success page
router.get('/setup-complete', async (req, res) => {
  const db = req.app.get('pgPool');
  try {
    const { token } = req.query;
    if (!token || typeof token !== 'string') {
      throw new Error('Setup token required');
    }
    
    const setupInfo = await UserSetupService.getSetupToken(db, token);
    
    if (!setupInfo) {
      throw new Error('Invalid setup token');
    }
    
    const appUrl = process.env.APP_URL || `https://oms-client-01ry.onrender.com`;
    const loginUrl = `${appUrl}`;
    
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Welcome to OMS!</title>
    <style>
      body { 
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
        background: #f8f9fa;
        min-height: 100vh;
        margin: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        color: #333;
      }
      .container { 
        background: white;
        max-width: 520px; 
        width: 100%;
        border-radius: 8px; 
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        border: 1px solid #e9ecef;
        overflow: hidden;
        text-align: center;
      }
      .header {
        background: #000;
        padding: 40px 30px;
        color: white;
      }
      .header .icon { font-size: 48px; margin-bottom: 20px; }
      .header h1 { margin: 0; font-size: 28px; font-weight: 600; }
      .header p { margin: 15px 0 0 0; opacity: 0.9; font-size: 16px; }
      .content { padding: 40px 30px; }
      .welcome-info {
        background: #f8f9fa;
        padding: 25px;
        border-radius: 4px;
        margin-bottom: 30px;
        border-left: 4px solid #000;
      }
      .welcome-info h3 { margin: 0 0 15px 0; color: #333; font-size: 18px; }
      .welcome-info p { margin: 5px 0; color: #666; }
      .access-link {
        display: inline-block;
        background: #000;
        color: white;
        padding: 15px 30px;
        text-decoration: none;
        border-radius: 4px;
        font-weight: 500;
        font-size: 16px;
        margin: 20px 0;
        transition: background-color 0.3s;
      }
      .access-link:hover { background: #333; }
      .next-steps {
        background: #f8f9fa;
        padding: 25px;
        border-radius: 4px;
        margin-top: 30px;
        border-left: 4px solid #000;
        text-align: left;
      }
      .next-steps h4 { margin: 0 0 15px 0; color: #333; }
      .next-steps ul { margin: 0; padding-left: 20px; color: #666; }
      .next-steps li { margin: 8px 0; }
      .footer { 
        margin-top: 30px; 
        padding-top: 20px; 
        border-top: 1px solid #e1e5e9;
        color: #666; 
        font-size: 14px; 
      }
      .status { 
        padding: 15px; 
        border-radius: 4px; 
        margin-bottom: 20px; 
        font-size: 14px;
        background: #f8f9fa;
        border-left: 4px solid #000;
        color: #333;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <div class="icon">🎉</div>
        <h1>Welcome to OMS!</h1>
        <p>Your account setup is complete</p>
      </div>
      <div class="content">
        <div class="welcome-info">
          <h3>Hello, ${setupInfo.firstName} ${setupInfo.lastName}!</h3>
          <p><strong>Email:</strong> ${setupInfo.email}</p>
          <p><strong>Account Status:</strong> ${setupInfo.isExpired ? 'Active & Ready' : 'Setup Completed'}</p>
        </div>
        
        ${setupInfo.isExpired ? `
          <div class="status">
            🔒 Your setup token has been securely expired for security purposes
          </div>
        ` : ''}
        
        <p style="color: #333; font-size: 16px; margin-bottom: 30px;">
          Your OMS account has been successfully activated! You can now access the platform using your email and the password you just created.
        </p>
        
        <a href="${loginUrl}" class="access-link">
          🚀 Access OMS Platform
        </a>
        
        <div class="next-steps">
          <h4>🎯 What you can do now:</h4>
          <ul>
            <li>Log in using your email and password</li>
            <li>Explore the dashboard and features</li>
            <li>Update your profile information</li>
            <li>Contact support if you need assistance</li>
          </ul>
        </div>
        
        <div class="footer">
          <p>Save this page or bookmark the login link for easy access.</p>
          <p><strong>Login URL:</strong> <a href="${loginUrl}" style="color: #333;">${loginUrl}</a></p>
        </div>
      </div>
    </div>
  </body>
</html>`);
  } catch (error: any) {
    res.status(400).json({ success: false, error: { message: error.message } });
  }
});

export default router;
