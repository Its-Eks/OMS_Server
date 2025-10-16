import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DB || 'oms_platform';

async function addMissingTemplate() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const db = client.db(DB_NAME);
    const templates = db.collection('order_email_templates');
    
    // Add missing trial_fno_provisioning template
    const missingTemplate = {
      key: 'fiber_trial_fno_provisioning',
      orderType: 'new_installation',
      triggerStatus: 'trial_fno_provisioning',
      serviceType: 'fiber',
      subject: 'Fiber Line Application Submitted - {{customerName}}',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 20px; }
            h1 { font-size: 24px; font-weight: 600; margin: 0 0 24px 0; }
            p { margin: 0 0 16px 0; }
            .order-box { background: #f5f5f5; padding: 20px; margin: 24px 0; border-radius: 8px; }
            .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e5e5e5; }
            .row:last-child { border-bottom: none; }
            .label { color: #666; font-size: 14px; }
            .value { font-weight: 600; }
            .timeline { margin: 32px 0; }
            .timeline-step { padding: 16px 0; border-left: 2px solid #e5e5e5; padding-left: 20px; margin-left: 8px; position: relative; }
            .timeline-step:before { content: ''; width: 16px; height: 16px; border-radius: 50%; background: #fff; border: 2px solid #1a1a1a; position: absolute; left: -9px; top: 18px; }
            .timeline-step.active:before { background: #1a1a1a; }
            .timeline-step .step-title { font-weight: 600; margin-bottom: 4px; }
            .timeline-step .step-desc { font-size: 14px; color: #666; }
            .contact-box { border: 1px solid #e5e5e5; padding: 20px; margin: 24px 0; border-radius: 8px; }
            .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e5e5; font-size: 14px; color: #666; }
          </style>
        </head>
        <body>
          <h1>Fiber Line Application Submitted</h1>
          <p>Hi {{customerName}},</p>
          <p>We've submitted your fiber line application to the Fiber Network Operator (FNO).</p>
          
          <div class="order-box">
            <div class="row">
              <span class="label">Order number</span>
              <span class="value">{{orderNumber}}</span>
            </div>
            <div class="row">
              <span class="label">Service address</span>
              <span class="value">{{serviceAddress}}</span>
            </div>
            <div class="row">
              <span class="label">Package</span>
              <span class="value">{{packageName}}</span>
            </div>
          </div>
          
          <div class="timeline">
            <div class="timeline-step active">
              <div class="step-title">FNO Application Submitted</div>
              <div class="step-desc">We've submitted your application to the fiber network operator</div>
            </div>
            <div class="timeline-step">
              <div class="step-title">FNO Review</div>
              <div class="step-desc">The FNO will review your application (typically 2-3 business days)</div>
            </div>
            <div class="timeline-step">
              <div class="step-title">Installation Scheduled</div>
              <div class="step-desc">Once approved, we'll contact you to schedule your installation</div>
            </div>
            <div class="timeline-step">
              <div class="step-title">30-day trial begins</div>
              <div class="step-desc">Use everything - no payment needed until trial ends</div>
            </div>
          </div>
          
          <p>The FNO will review your application and typically respond within 2-3 business days. Once approved, we'll schedule your installation appointment.</p>
          
          <div class="contact-box">
            <p style="margin-bottom: 12px; font-weight: 600;">Need to reach us?</p>
            <p style="margin: 0; font-size: 14px;">
              Phone: {{supportPhone}}<br>
              Email: {{supportEmail}}<br>
              Reference: {{orderNumber}}
            </p>
          </div>
          
          <p>We'll email you again once we receive approval from the FNO.</p>
          
          <div class="footer">{{companyName}} Orders Team</div>
        </body>
        </html>
      `,
      text: `Fiber Line Application Submitted\n\nHi {{customerName}},\n\nWe've submitted your fiber line application to the Fiber Network Operator (FNO).\n\nOrder Number: {{orderNumber}}\nService Address: {{serviceAddress}}\nPackage: {{packageName}}\n\nThe FNO will review your application and typically respond within 2-3 business days. Once approved, we'll schedule your installation appointment.\n\nNeed to reach us?\nPhone: {{supportPhone}}\nEmail: {{supportEmail}}\nReference: {{orderNumber}}\n\nWe'll email you again once we receive approval from the FNO.\n\n{{companyName}} Orders Team`,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    // Insert the template
    await templates.insertOne(missingTemplate);
    console.log('✅ Added missing trial_fno_provisioning template');
    
  } catch (error) {
    console.error('❌ Error adding template:', error);
  } finally {
    await client.close();
  }
}

addMissingTemplate();
