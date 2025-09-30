import { Pool } from 'pg';
import { NotificationService } from './src/services/notification.service.ts';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  user: process.env.POSTGRES_USER || 'postgres',
  host: process.env.POSTGRES_HOST || 'localhost',
  database: process.env.POSTGRES_DB || 'oms_platform',
  password: process.env.POSTGRES_PASSWORD || 'password',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false
});

async function testNotifications() {
  console.log('🔔 Testing Notification System...\n');

  try {
    // 1. Check SMTP configuration
    console.log('1️⃣ SMTP Configuration:');
    console.log(`   SMTP_HOST: ${process.env.SMTP_HOST || 'Not set'}`);
    console.log(`   SMTP_PORT: ${process.env.SMTP_PORT || 'Not set'}`);
    console.log(`   SMTP_USER: ${process.env.SMTP_USER || 'Not set'}`);
    console.log(`   SMTP_FROM: ${process.env.SMTP_FROM || 'Not set'}`);
    console.log(`   OPS_EMAIL: ${process.env.OPS_EMAIL || 'Not set'}`);
    console.log('');

    // 2. Test notification service
    console.log('2️⃣ Testing Notification Service:');
    const notificationService = new NotificationService();
    
    // Test email sending
    const testEmail = process.env.OPS_EMAIL || 'test@example.com';
    console.log(`   Sending test email to: ${testEmail}`);
    
    const emailResult = await notificationService.send({
      to: testEmail,
      subject: 'Test Escalation Notification',
      html: '<p><strong>Test Escalation</strong><br/>This is a test notification for escalation system.</p>',
      text: 'Test Escalation - This is a test notification for escalation system.'
    });

    if (emailResult) {
      console.log('   ✅ Email sent successfully!');
    } else {
      console.log('   ❌ Email sending failed');
    }
    console.log('');

    // 3. Check Operations Manager emails
    console.log('3️⃣ Operations Manager Emails:');
    const omUsers = await pool.query(`
      SELECT 
        u.id,
        u.first_name,
        u.last_name,
        u.email,
        u.is_active,
        r.name as role_name
      FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE r.name = 'Operations Manager'
      ORDER BY u.first_name
    `);

    console.log(`Found ${omUsers.rows.length} Operations Manager(s):`);
    omUsers.rows.forEach((user, index) => {
      console.log(`  ${index + 1}. ${user.first_name} ${user.last_name}`);
      console.log(`     Email: ${user.email}`);
      console.log(`     Active: ${user.is_active}`);
      console.log(`     Role: ${user.role_name}`);
      console.log('');
    });

    // 4. Test escalation notification
    console.log('4️⃣ Testing Escalation Notification:');
    if (omUsers.rows.length > 0) {
      const testOM = omUsers.rows[0];
      console.log(`   Sending escalation notification to: ${testOM.email}`);
      
      const escalationResult = await notificationService.send({
        to: testOM.email,
        subject: 'Escalation L1 for order ORD-TEST-123',
        html: `
          <p><strong>Escalation Alert</strong></p>
          <p><strong>Order:</strong> ORD-TEST-123<br/>
          <strong>Level:</strong> 1<br/>
          <strong>Reason:</strong> Test escalation notification<br/>
          <strong>Assigned to:</strong> ${testOM.first_name} ${testOM.last_name}</p>
        `,
        text: `Escalation L1 for order ORD-TEST-123. Assigned to: ${testOM.first_name} ${testOM.last_name}`
      });

      if (escalationResult) {
        console.log('   ✅ Escalation notification sent successfully!');
      } else {
        console.log('   ❌ Escalation notification failed');
      }
    } else {
      console.log('   ⚠️  No Operations Managers found to test with');
    }
    console.log('');

    // 5. Check recent escalation notifications
    console.log('5️⃣ Recent Escalation Activity:');
    const recentEscalations = await pool.query(`
      SELECT 
        e.id,
        e.escalated_to,
        u.first_name || ' ' || u.last_name as assigned_to_name,
        o.order_number,
        e.status,
        e.escalation_level,
        e.created_at
      FROM escalations e
      LEFT JOIN users u ON u.id = e.escalated_to
      LEFT JOIN orders o ON o.id = e.order_id
      ORDER BY e.created_at DESC
      LIMIT 5
    `);

    console.log('Recent Escalations:');
    recentEscalations.rows.forEach((escalation, index) => {
      const assignee = escalation.assigned_to_name || 'Unassigned';
      console.log(`  ${index + 1}. ${escalation.order_number || 'N/A'}`);
      console.log(`     Assigned to: ${assignee}`);
      console.log(`     Status: ${escalation.status}`);
      console.log(`     Level: ${escalation.escalation_level}`);
      console.log(`     Created: ${escalation.created_at}`);
      console.log('');
    });

    console.log('✅ Notification testing completed!');

  } catch (error) {
    console.error('❌ Error testing notifications:', error);
  } finally {
    await pool.end();
  }
}

testNotifications().catch(console.error);
