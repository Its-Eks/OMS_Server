import axios from 'axios';

const API_BASE_URL = 'http://localhost:3003';

// Trial Email Templates
const trialTemplates = [
  // Fiber Trial Templates
  {
    key: 'new_installation:trial_order_created',
    orderType: 'new_installation',
    triggerStatus: 'trial_order_created',
    serviceType: 'fiber',
    subject: 'Your Fiber Trial Order is Confirmed - {{customerName}}',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">🎉 Welcome to Your Fiber Trial!</h2>
        <p>Hi {{customerName}},</p>
        <p>Your fiber internet trial order has been confirmed and is being processed.</p>
        <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Order Number:</strong> {{orderNumber}}</p>
          <p><strong>Service Type:</strong> Fiber Internet</p>
          <p><strong>Address:</strong> {{address}}</p>
          <p><strong>Trial Duration:</strong> 30 days</p>
        </div>
        <p>Our team will contact the Fiber Network Operator (FNO) to provision your fiber line. This process typically takes 3-5 business days.</p>
        <p>You'll receive updates as we progress through the setup process.</p>
        <p>Best regards,<br>The Team</p>
      </div>
    `,
    text: `Welcome to Your Fiber Trial!\n\nHi {{customerName}},\n\nYour fiber internet trial order has been confirmed and is being processed.\n\nOrder Number: {{orderNumber}}\nService Type: Fiber Internet\nAddress: {{address}}\nTrial Duration: 30 days\n\nOur team will contact the Fiber Network Operator (FNO) to provision your fiber line. This process typically takes 3-5 business days.\n\nYou'll receive updates as we progress through the setup process.\n\nBest regards,\nThe Team`,
    isActive: true
  },
  {
    key: 'new_installation:trial_fno_provisioning',
    orderType: 'new_installation',
    triggerStatus: 'trial_fno_provisioning',
    serviceType: 'fiber',
    subject: 'Fiber Line Application Submitted - {{customerName}}',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">🔧 Fiber Line Application Submitted</h2>
        <p>Hi {{customerName}},</p>
        <p>Great news! We've submitted your fiber line application to the network operator.</p>
        <div style="background: #f0f9ff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #2563eb;">
          <p><strong>Order Number:</strong> {{orderNumber}}</p>
          <p><strong>Status:</strong> FNO Provisioning in Progress</p>
          <p><strong>Expected Timeline:</strong> 3-5 business days</p>
        </div>
        <p>What happens next:</p>
        <ul>
          <li>FNO reviews your application</li>
          <li>Fiber line is provisioned to your address</li>
          <li>We schedule your installation appointment</li>
        </ul>
        <p>We'll keep you updated on the progress!</p>
        <p>Best regards,<br>The Team</p>
      </div>
    `,
    text: `Fiber Line Application Submitted\n\nHi {{customerName}},\n\nGreat news! We've submitted your fiber line application to the network operator.\n\nOrder Number: {{orderNumber}}\nStatus: FNO Provisioning in Progress\nExpected Timeline: 3-5 business days\n\nWhat happens next:\n- FNO reviews your application\n- Fiber line is provisioned to your address\n- We schedule your installation appointment\n\nWe'll keep you updated on the progress!\n\nBest regards,\nThe Team`,
    isActive: true
  },
  {
    key: 'new_installation:trial_installation_pending',
    orderType: 'new_installation',
    triggerStatus: 'trial_installation_pending',
    serviceType: 'fiber',
    subject: 'Installation Appointment Required - {{customerName}}',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">📅 Installation Appointment Required</h2>
        <p>Hi {{customerName}},</p>
        <p>Your fiber line has been provisioned! Now we need to schedule your installation appointment.</p>
        <div style="background: #fef3c7; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b;">
          <p><strong>Order Number:</strong> {{orderNumber}}</p>
          <p><strong>Status:</strong> Ready for Installation</p>
          <p><strong>Next Step:</strong> Schedule Installation</p>
        </div>
        <p>Please contact us to schedule your installation appointment at your convenience.</p>
        <p><strong>Contact:</strong> support@company.com | (123) 456-7890</p>
        <p>Best regards,<br>The Team</p>
      </div>
    `,
    text: `Installation Appointment Required\n\nHi {{customerName}},\n\nYour fiber line has been provisioned! Now we need to schedule your installation appointment.\n\nOrder Number: {{orderNumber}}\nStatus: Ready for Installation\nNext Step: Schedule Installation\n\nPlease contact us to schedule your installation appointment at your convenience.\n\nContact: support@company.com | (123) 456-7890\n\nBest regards,\nThe Team`,
    isActive: true
  },
  {
    key: 'new_installation:trial_installation_scheduled',
    orderType: 'new_installation',
    triggerStatus: 'trial_installation_scheduled',
    serviceType: 'fiber',
    subject: 'Installation Appointment Confirmed - {{customerName}}',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #16a34a;">✅ Installation Appointment Confirmed</h2>
        <p>Hi {{customerName}},</p>
        <p>Your fiber installation appointment has been confirmed!</p>
        <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #16a34a;">
          <p><strong>Order Number:</strong> {{orderNumber}}</p>
          <p><strong>Installation Date:</strong> {{appointmentDate}}</p>
          <p><strong>Time Slot:</strong> {{appointmentTime}}</p>
          <p><strong>Technician:</strong> {{technicianName}}</p>
        </div>
        <p><strong>What to expect:</strong></p>
        <ul>
          <li>Professional technician will arrive at scheduled time</li>
          <li>Fiber line will be connected to your premises</li>
          <li>Service will be tested and activated</li>
          <li>You'll receive your trial login credentials</li>
        </ul>
        <p>Please ensure someone is available at the property during the appointment.</p>
        <p>Best regards,<br>The Team</p>
      </div>
    `,
    text: `Installation Appointment Confirmed\n\nHi {{customerName}},\n\nYour fiber installation appointment has been confirmed!\n\nOrder Number: {{orderNumber}}\nInstallation Date: {{appointmentDate}}\nTime Slot: {{appointmentTime}}\nTechnician: {{technicianName}}\n\nWhat to expect:\n- Professional technician will arrive at scheduled time\n- Fiber line will be connected to your premises\n- Service will be tested and activated\n- You'll receive your trial login credentials\n\nPlease ensure someone is available at the property during the appointment.\n\nBest regards,\nThe Team`,
    isActive: true
  },
  {
    key: 'new_installation:trial_active',
    orderType: 'new_installation',
    triggerStatus: 'trial_active',
    serviceType: 'fiber',
    subject: 'Your Fiber Trial is Now Active! - {{customerName}}',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #16a34a;">🚀 Your Fiber Trial is Now Active!</h2>
        <p>Hi {{customerName}},</p>
        <p>Congratulations! Your fiber internet trial is now active and ready to use.</p>
        <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #16a34a;">
          <p><strong>Order Number:</strong> {{orderNumber}}</p>
          <p><strong>Service Status:</strong> Active</p>
          <p><strong>Trial Duration:</strong> 30 days</p>
          <p><strong>Login Credentials:</strong> Check your welcome packet</p>
        </div>
        <p><strong>Your trial includes:</strong></p>
        <ul>
          <li>High-speed fiber internet</li>
          <li>Unlimited data usage</li>
          <li>24/7 customer support</li>
          <li>Professional installation</li>
        </ul>
        <p>Enjoy your trial! If you have any questions, don't hesitate to contact us.</p>
        <p>Best regards,<br>The Team</p>
      </div>
    `,
    text: `Your Fiber Trial is Now Active!\n\nHi {{customerName}},\n\nCongratulations! Your fiber internet trial is now active and ready to use.\n\nOrder Number: {{orderNumber}}\nService Status: Active\nTrial Duration: 30 days\nLogin Credentials: Check your welcome packet\n\nYour trial includes:\n- High-speed fiber internet\n- Unlimited data usage\n- 24/7 customer support\n- Professional installation\n\nEnjoy your trial! If you have any questions, don't hesitate to contact us.\n\nBest regards,\nThe Team`,
    isActive: true
  },
  // Wireless Trial Templates
  {
    key: 'new_installation:trial_order_created_wireless',
    orderType: 'new_installation',
    triggerStatus: 'trial_order_created',
    serviceType: 'wireless',
    subject: 'Your Wireless Trial Order is Confirmed - {{customerName}}',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #7c3aed;">📡 Welcome to Your Wireless Trial!</h2>
        <p>Hi {{customerName}},</p>
        <p>Your wireless internet trial order has been confirmed and is being processed.</p>
        <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Order Number:</strong> {{orderNumber}}</p>
          <p><strong>Service Type:</strong> Wireless Internet</p>
          <p><strong>Address:</strong> {{address}}</p>
          <p><strong>Trial Duration:</strong> 30 days</p>
        </div>
        <p>Your wireless device will be shipped to your address within 1-2 business days.</p>
        <p>You'll receive tracking information once your device ships.</p>
        <p>Best regards,<br>The Team</p>
      </div>
    `,
    text: `Welcome to Your Wireless Trial!\n\nHi {{customerName}},\n\nYour wireless internet trial order has been confirmed and is being processed.\n\nOrder Number: {{orderNumber}}\nService Type: Wireless Internet\nAddress: {{address}}\nTrial Duration: 30 days\n\nYour wireless device will be shipped to your address within 1-2 business days.\n\nYou'll receive tracking information once your device ships.\n\nBest regards,\nThe Team`,
    isActive: true
  },
  {
    key: 'new_installation:trial_device_shipping',
    orderType: 'new_installation',
    triggerStatus: 'trial_device_shipping',
    serviceType: 'wireless',
    subject: 'Your Wireless Device is Shipping - {{customerName}}',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #7c3aed;">📦 Your Wireless Device is Shipping!</h2>
        <p>Hi {{customerName}},</p>
        <p>Great news! Your wireless device has been shipped and is on its way.</p>
        <div style="background: #f0f9ff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #7c3aed;">
          <p><strong>Order Number:</strong> {{orderNumber}}</p>
          <p><strong>Tracking Number:</strong> {{trackingNumber}}</p>
          <p><strong>Expected Delivery:</strong> 1-2 business days</p>
        </div>
        <p>What's included in your package:</p>
        <ul>
          <li>Wireless router/device</li>
          <li>Power adapter</li>
          <li>Ethernet cable</li>
          <li>Quick start guide</li>
        </ul>
        <p>Once delivered, follow the setup instructions to activate your trial.</p>
        <p>Best regards,<br>The Team</p>
      </div>
    `,
    text: `Your Wireless Device is Shipping!\n\nHi {{customerName}},\n\nGreat news! Your wireless device has been shipped and is on its way.\n\nOrder Number: {{orderNumber}}\nTracking Number: {{trackingNumber}}\nExpected Delivery: 1-2 business days\n\nWhat's included in your package:\n- Wireless router/device\n- Power adapter\n- Ethernet cable\n- Quick start guide\n\nOnce delivered, follow the setup instructions to activate your trial.\n\nBest regards,\nThe Team`,
    isActive: true
  },
  {
    key: 'new_installation:trial_device_delivered',
    orderType: 'new_installation',
    triggerStatus: 'trial_device_delivered',
    serviceType: 'wireless',
    subject: 'Your Wireless Device Has Arrived - {{customerName}}',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #16a34a;">📦 Your Wireless Device Has Arrived!</h2>
        <p>Hi {{customerName}},</p>
        <p>Your wireless device has been delivered and is ready for setup.</p>
        <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #16a34a;">
          <p><strong>Order Number:</strong> {{orderNumber}}</p>
          <p><strong>Delivery Status:</strong> Delivered</p>
          <p><strong>Next Step:</strong> Self-Installation</p>
        </div>
        <p><strong>Setup Instructions:</strong></p>
        <ol>
          <li>Unpack your wireless device</li>
          <li>Connect the power adapter</li>
          <li>Follow the quick start guide</li>
          <li>Test your connection</li>
        </ol>
        <p>Need help? Contact our support team for assistance.</p>
        <p>Best regards,<br>The Team</p>
      </div>
    `,
    text: `Your Wireless Device Has Arrived!\n\nHi {{customerName}},\n\nYour wireless device has been delivered and is ready for setup.\n\nOrder Number: {{orderNumber}}\nDelivery Status: Delivered\nNext Step: Self-Installation\n\nSetup Instructions:\n1. Unpack your wireless device\n2. Connect the power adapter\n3. Follow the quick start guide\n4. Test your connection\n\nNeed help? Contact our support team for assistance.\n\nBest regards,\nThe Team`,
    isActive: true
  },
  {
    key: 'new_installation:trial_self_install',
    orderType: 'new_installation',
    triggerStatus: 'trial_self_install',
    serviceType: 'wireless',
    subject: 'Complete Your Wireless Setup - {{customerName}}',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #f59e0b;">🔧 Complete Your Wireless Setup</h2>
        <p>Hi {{customerName}},</p>
        <p>It's time to set up your wireless device and start your trial!</p>
        <div style="background: #fef3c7; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b;">
          <p><strong>Order Number:</strong> {{orderNumber}}</p>
          <p><strong>Status:</strong> Ready for Self-Installation</p>
          <p><strong>Setup Time:</strong> 15-30 minutes</p>
        </div>
        <p><strong>Step-by-Step Setup:</strong></p>
        <ol>
          <li>Find the best location for your device</li>
          <li>Connect power and wait for lights to stabilize</li>
          <li>Connect your devices via WiFi or Ethernet</li>
          <li>Test your internet connection</li>
        </ol>
        <p>Need assistance? Our support team is here to help!</p>
        <p>Best regards,<br>The Team</p>
      </div>
    `,
    text: `Complete Your Wireless Setup\n\nHi {{customerName}},\n\nIt's time to set up your wireless device and start your trial!\n\nOrder Number: {{orderNumber}}\nStatus: Ready for Self-Installation\nSetup Time: 15-30 minutes\n\nStep-by-Step Setup:\n1. Find the best location for your device\n2. Connect power and wait for lights to stabilize\n3. Connect your devices via WiFi or Ethernet\n4. Test your internet connection\n\nNeed assistance? Our support team is here to help!\n\nBest regards,\nThe Team`,
    isActive: true
  },
  {
    key: 'new_installation:trial_active_wireless',
    orderType: 'new_installation',
    triggerStatus: 'trial_active',
    serviceType: 'wireless',
    subject: 'Your Wireless Trial is Now Active! - {{customerName}}',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #16a34a;">🚀 Your Wireless Trial is Now Active!</h2>
        <p>Hi {{customerName}},</p>
        <p>Congratulations! Your wireless internet trial is now active and ready to use.</p>
        <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #16a34a;">
          <p><strong>Order Number:</strong> {{orderNumber}}</p>
          <p><strong>Service Status:</strong> Active</p>
          <p><strong>Trial Duration:</strong> 30 days</p>
          <p><strong>Login Credentials:</strong> Check your welcome packet</p>
        </div>
        <p><strong>Your trial includes:</strong></p>
        <ul>
          <li>Reliable wireless internet</li>
          <li>Unlimited data usage</li>
          <li>24/7 customer support</li>
          <li>Self-installation setup</li>
        </ul>
        <p>Enjoy your trial! If you have any questions, don't hesitate to contact us.</p>
        <p>Best regards,<br>The Team</p>
      </div>
    `,
    text: `Your Wireless Trial is Now Active!\n\nHi {{customerName}},\n\nCongratulations! Your wireless internet trial is now active and ready to use.\n\nOrder Number: {{orderNumber}}\nService Status: Active\nTrial Duration: 30 days\nLogin Credentials: Check your welcome packet\n\nYour trial includes:\n- Reliable wireless internet\n- Unlimited data usage\n- 24/7 customer support\n- Self-installation setup\n\nEnjoy your trial! If you have any questions, don't hesitate to contact us.\n\nBest regards,\nThe Team`,
    isActive: true
  }
];

async function addTrialTemplates() {
  console.log('🚀 Adding trial email templates via API...');
  
  for (const template of trialTemplates) {
    try {
      console.log(`Adding template: ${template.key}`);
      
      const response = await axios.post(`${API_BASE_URL}/orders-templates`, template, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (response.data.success) {
        console.log(`✅ Successfully added: ${template.key}`);
      } else {
        console.log(`⚠️  Template may already exist: ${template.key}`);
      }
    } catch (error) {
      if (error.response?.status === 409) {
        console.log(`⚠️  Template already exists: ${template.key}`);
      } else {
        console.error(`❌ Error adding template ${template.key}:`, {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          message: error.message
        });
      }
    }
  }
  
  console.log('🎉 Finished adding trial email templates!');
}

addTrialTemplates().catch(console.error);
