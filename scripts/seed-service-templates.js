const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DB || 'oms_platform';

async function seedServiceTemplates() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const db = client.db(DB_NAME);
    const templates = db.collection('order_email_templates');
    
    // Clear existing templates
    await templates.deleteMany({});
    console.log('Cleared existing templates');
    
    // Fiber Trial Templates
    const fiberTemplates = [
      {
        key: 'fiber_trial_order_created',
        orderType: 'new_installation',
        triggerStatus: 'trial_order_created',
        serviceType: 'fiber',
        subject: 'Your Fiber Trial Order is Confirmed - {{customerName}}',
        html: `
          <h2>Welcome to Your Fiber Trial!</h2>
          <p>Hi {{customerName}},</p>
          <p>Your fiber internet trial order has been confirmed and is being processed.</p>
          <p><strong>Order Number:</strong> {{orderNumber}}</p>
          <p><strong>Service Type:</strong> Fiber Internet</p>
          <p><strong>Address:</strong> {{address}}</p>
          <p>Our team will contact the Fiber Network Operator (FNO) to provision your fiber line. This process typically takes 3-5 business days.</p>
          <p>You'll receive updates as we progress through the setup process.</p>
          <p>Best regards,<br>The Team</p>
        `,
        text: `Welcome to Your Fiber Trial!\n\nHi {{customerName}},\n\nYour fiber internet trial order has been confirmed and is being processed.\n\nOrder Number: {{orderNumber}}\nService Type: Fiber Internet\nAddress: {{address}}\n\nOur team will contact the Fiber Network Operator (FNO) to provision your fiber line. This process typically takes 3-5 business days.\n\nYou'll receive updates as we progress through the setup process.\n\nBest regards,\nThe Team`,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        key: 'fiber_trial_fno_provisioning',
        orderType: 'new_installation',
        triggerStatus: 'trial_fno_provisioning',
        serviceType: 'fiber',
        subject: 'Fiber Line Application Submitted - {{customerName}}',
        html: `
          <h2>Fiber Line Application Submitted</h2>
          <p>Hi {{customerName}},</p>
          <p>We've submitted your fiber line application to the Fiber Network Operator (FNO).</p>
          <p><strong>Order Number:</strong> {{orderNumber}}</p>
          <p>The FNO will review your application and typically respond within 2-3 business days.</p>
          <p>Once approved, we'll schedule your installation appointment.</p>
          <p>Best regards,<br>The Team</p>
        `,
        text: `Fiber Line Application Submitted\n\nHi {{customerName}},\n\nWe've submitted your fiber line application to the Fiber Network Operator (FNO).\n\nOrder Number: {{orderNumber}}\n\nThe FNO will review your application and typically respond within 2-3 business days.\n\nOnce approved, we'll schedule your installation appointment.\n\nBest regards,\nThe Team`,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        key: 'fiber_trial_installation_scheduled',
        orderType: 'new_installation',
        triggerStatus: 'trial_installation_scheduled',
        serviceType: 'fiber',
        subject: 'Fiber Installation Scheduled - {{customerName}}',
        html: `
          <h2>Your Fiber Installation is Scheduled!</h2>
          <p>Hi {{customerName}},</p>
          <p>Great news! Your fiber installation has been scheduled.</p>
          <p><strong>Order Number:</strong> {{orderNumber}}</p>
          <p><strong>Installation Date:</strong> {{installationDate}}</p>
          <p><strong>Technician:</strong> {{technicianName}}</p>
          <p><strong>Contact:</strong> {{contactNumber}}</p>
          <p>Please ensure someone is available at the installation address during the scheduled time.</p>
          <p>Best regards,<br>The Team</p>
        `,
        text: `Your Fiber Installation is Scheduled!\n\nHi {{customerName}},\n\nGreat news! Your fiber installation has been scheduled.\n\nOrder Number: {{orderNumber}}\nInstallation Date: {{installationDate}}\nTechnician: {{technicianName}}\nContact: {{contactNumber}}\n\nPlease ensure someone is available at the installation address during the scheduled time.\n\nBest regards,\nThe Team`,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];
    
    // Wireless Trial Templates
    const wirelessTemplates = [
      {
        key: 'wireless_trial_order_created',
        orderType: 'new_installation',
        triggerStatus: 'trial_order_created',
        serviceType: 'wireless',
        subject: 'Your Wireless Trial Order is Confirmed - {{customerName}}',
        html: `
          <h2>Welcome to Your Wireless Trial!</h2>
          <p>Hi {{customerName}},</p>
          <p>Your wireless internet trial order has been confirmed and is being processed.</p>
          <p><strong>Order Number:</strong> {{orderNumber}}</p>
          <p><strong>Service Type:</strong> Wireless Internet</p>
          <p><strong>Address:</strong> {{address}}</p>
          <p>We'll ship your wireless router and installation kit within 1-2 business days. You'll receive tracking information once it's dispatched.</p>
          <p>Once delivered, you can easily set up your wireless internet service using our self-installation guide.</p>
          <p>Best regards,<br>The Team</p>
        `,
        text: `Welcome to Your Wireless Trial!\n\nHi {{customerName}},\n\nYour wireless internet trial order has been confirmed and is being processed.\n\nOrder Number: {{orderNumber}}\nService Type: Wireless Internet\nAddress: {{address}}\n\nWe'll ship your wireless router and installation kit within 1-2 business days. You'll receive tracking information once it's dispatched.\n\nOnce delivered, you can easily set up your wireless internet service using our self-installation guide.\n\nBest regards,\nThe Team`,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        key: 'wireless_trial_device_shipping',
        orderType: 'new_installation',
        triggerStatus: 'trial_device_shipping',
        serviceType: 'wireless',
        subject: 'Your Wireless Device is on the Way - {{customerName}}',
        html: `
          <h2>Your Wireless Device is Shipping!</h2>
          <p>Hi {{customerName}},</p>
          <p>Your wireless router and installation kit have been dispatched.</p>
          <p><strong>Order Number:</strong> {{orderNumber}}</p>
          <p><strong>Tracking Number:</strong> {{trackingNumber}}</p>
          <p>Expected delivery: 1-2 business days</p>
          <p>Once delivered, you'll receive installation instructions to set up your wireless internet service.</p>
          <p>Best regards,<br>The Team</p>
        `,
        text: `Your Wireless Device is Shipping!\n\nHi {{customerName}},\n\nYour wireless router and installation kit have been dispatched.\n\nOrder Number: {{orderNumber}}\nTracking Number: {{trackingNumber}}\nExpected delivery: 1-2 business days\n\nOnce delivered, you'll receive installation instructions to set up your wireless internet service.\n\nBest regards,\nThe Team`,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        key: 'wireless_trial_device_delivered',
        orderType: 'new_installation',
        triggerStatus: 'trial_device_delivered',
        serviceType: 'wireless',
        subject: 'Your Wireless Device Has Arrived - {{customerName}}',
        html: `
          <h2>Your Wireless Device Has Arrived!</h2>
          <p>Hi {{customerName}},</p>
          <p>Your wireless router has been delivered and is ready for installation.</p>
          <p><strong>Order Number:</strong> {{orderNumber}}</p>
          <p>Please follow our simple self-installation guide to set up your wireless internet service:</p>
          <ol>
            <li>Unpack the router and power adapter</li>
            <li>Connect the router to power</li>
            <li>Follow the setup instructions in the package</li>
            <li>Test your connection</li>
          </ol>
          <p>If you need assistance, contact us at {{contactNumber}}.</p>
          <p>Best regards,<br>The Team</p>
        `,
        text: `Your Wireless Device Has Arrived!\n\nHi {{customerName}},\n\nYour wireless router has been delivered and is ready for installation.\n\nOrder Number: {{orderNumber}}\n\nPlease follow our simple self-installation guide:\n1. Unpack the router and power adapter\n2. Connect the router to power\n3. Follow the setup instructions in the package\n4. Test your connection\n\nIf you need assistance, contact us at {{contactNumber}}.\n\nBest regards,\nThe Team`,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];
    
    // Insert all templates
    const allTemplates = [...fiberTemplates, ...wirelessTemplates];
    const result = await templates.insertMany(allTemplates);
    
    console.log(`✅ Successfully seeded ${result.insertedCount} service-specific email templates`);
    console.log('Fiber templates:', fiberTemplates.length);
    console.log('Wireless templates:', wirelessTemplates.length);
    
  } catch (error) {
    console.error('Error seeding templates:', error);
  } finally {
    await client.close();
  }
}

// Run the seeding function
seedServiceTemplates().catch(console.error);
