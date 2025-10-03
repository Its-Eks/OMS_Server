const axios = require('axios');

const OMS_SERVER_URL = 'http://localhost:3000';
const ONBOARDING_SERVICE_URL = 'http://localhost:3004';

async function testPaymentIntegration() {
  console.log('🧪 Testing Payment Integration Flow...\n');

  try {
    // Step 1: Create a customer first
    console.log('1️⃣ Creating customer...');
    const customerResponse = await axios.post(`${OMS_SERVER_URL}/customers`, {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john.doe@example.com',
      phone: '+27123456789',
      address: {
        street: '123 Test Street',
        city: 'Cape Town',
        province: 'Western Cape',
        postalCode: '8001'
      }
    });

    if (!customerResponse.data.success) {
      throw new Error('Failed to create customer');
    }

    const customerId = customerResponse.data.customer.id;
    console.log(`✅ Customer created: ${customerId}`);

    // Step 2: Create an order (this should trigger payment link generation)
    console.log('\n2️⃣ Creating order (should auto-generate payment link)...');
    const orderResponse = await axios.post(`${OMS_SERVER_URL}/orders`, {
      customerId: customerId,
      orderType: 'new_install',
      priority: 'medium',
      serviceAddress: {
        street: '123 Test Street',
        city: 'Cape Town',
        province: 'Western Cape',
        postalCode: '8001'
      },
      serviceDetails: {
        serviceType: 'internet',
        bandwidth: '100/50 Mbps',
        installationType: 'professional_install',
        price: 749,
        installationFee: 999
      }
    });

    if (!orderResponse.data.success) {
      throw new Error('Failed to create order');
    }

    const orderId = orderResponse.data.orderId;
    console.log(`✅ Order created: ${orderId}`);

    // Step 3: Wait a moment for async payment link generation
    console.log('\n3️⃣ Waiting for payment link generation...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 4: Check if payment link was created
    console.log('\n4️⃣ Checking payment links...');
    const paymentResponse = await axios.get(`${ONBOARDING_SERVICE_URL}/api/payments/status/${orderId}`, {
      headers: {
        'x-service-key': 'dev-service-key'
      }
    });

    if (paymentResponse.data.success && paymentResponse.data.paymentLink) {
      console.log(`✅ Payment link found: ${paymentResponse.data.paymentLink.url}`);
      console.log(`💰 Amount: R${paymentResponse.data.paymentLink.amount / 100}`);
      console.log(`📧 Customer email: ${paymentResponse.data.paymentLink.customerEmail}`);
    } else {
      console.log('❌ No payment link found');
    }

    console.log('\n🎉 Payment integration test completed!');
    console.log('\n📋 Summary:');
    console.log(`- Customer ID: ${customerId}`);
    console.log(`- Order ID: ${orderId}`);
    console.log(`- Payment Link: ${paymentResponse.data.paymentLink?.url || 'Not found'}`);

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

// Run the test
testPaymentIntegration();
