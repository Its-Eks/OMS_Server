// Debug script to test MongoDB connection and orders-templates service
import { connectMongoDB, mongoClient, mongodb } from './src/Database/main.ts';
import { OrdersTemplatesService } from './src/services/orders-templates.service.ts';
import dotenv from 'dotenv';

dotenv.config();

async function debug() {
  console.log('🔍 Debug: Testing Orders Templates Service');
  console.log('==========================================');
  
  try {
    // Test environment variables
    console.log('\n1. Environment Variables:');
    console.log('   MONGODB_URI:', process.env.MONGODB_URI ? 'Set' : 'Missing');
    console.log('   MONGODB_DB:', process.env.MONGODB_DB || 'Not set (will use default)');
    
    // Test MongoDB connection
    console.log('\n2. Testing MongoDB Connection...');
    const { mongoClient: client, mongodb: db } = await connectMongoDB();
    console.log('   ✅ MongoDB connected successfully');
    console.log('   Database name:', db.databaseName);
    
    // Test OrdersTemplatesService
    console.log('\n3. Testing OrdersTemplatesService...');
    const service = new OrdersTemplatesService(client);
    console.log('   ✅ Service instantiated successfully');
    
    // Test getting templates (should be empty initially)
    console.log('\n4. Testing getTemplates method...');
    const templates = await service.getTemplates();
    console.log(`   ✅ getTemplates() returned ${templates.length} templates`);
    
    // Test seeding default templates
    console.log('\n5. Testing seedDefaultTemplates...');
    const seedResult = await service.seedDefaultTemplates();
    console.log(`   ✅ Seeding result: ${seedResult.created} created, ${seedResult.skipped} skipped`);
    
    // Test getting templates after seeding
    console.log('\n6. Testing getTemplates after seeding...');
    const templatesAfterSeed = await service.getTemplates();
    console.log(`   ✅ getTemplates() now returns ${templatesAfterSeed.length} templates`);
    
    templatesAfterSeed.forEach(template => {
      console.log(`      - ${template.orderType}:${template.triggerStatus} (${template.key})`);
    });
    
    console.log('\n🎉 All tests passed! The service is working correctly.');
    
  } catch (error) {
    console.error('\n❌ Error during testing:', error);
    console.error('Stack:', error.stack);
    
    // Additional debugging
    if (error.message?.includes('MongoDB')) {
      console.log('\n🔧 MongoDB Debug Info:');
      console.log('   Current mongoClient:', mongoClient ? 'Available' : 'null');
      console.log('   Current mongodb:', mongodb ? 'Available' : 'null');
    }
  } finally {
    // Close connection
    if (mongoClient) {
      await mongoClient.close();
      console.log('\n📝 MongoDB connection closed');
    }
    process.exit(0);
  }
}

debug();
