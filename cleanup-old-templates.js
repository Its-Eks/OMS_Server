// Script to clean up old templates and keep only the simplified 4 templates
import { connectMongoDB } from './src/Database/main.ts';
import { OrdersTemplatesService } from './src/services/orders-templates.service.ts';
import dotenv from 'dotenv';

dotenv.config();

async function cleanup() {
  console.log('🧹 Cleaning up old email templates...');
  console.log('===================================');
  
  try {
    const { mongoClient } = await connectMongoDB();
    const service = new OrdersTemplatesService(mongoClient);
    
    // Get all current templates
    const allTemplates = await service.getTemplates();
    console.log(`Found ${allTemplates.length} total templates`);
    
    // Define the 4 templates we want to keep
    const keepTemplates = [
      'new_installation_scheduled',
      'new_installation_completed', 
      'service_change_scheduled',
      'service_change_completed'
    ];
    
    console.log('\n📋 Templates to keep:');
    keepTemplates.forEach(key => console.log(`   ✅ ${key}`));
    
    // Find templates to delete
    const templatesToDelete = allTemplates.filter(template => 
      !keepTemplates.includes(template.key)
    );
    
    if (templatesToDelete.length === 0) {
      console.log('\n✨ No old templates to delete. Database is clean!');
    } else {
      console.log(`\n🗑️ Templates to delete (${templatesToDelete.length}):`);
      
      for (const template of templatesToDelete) {
        console.log(`   ❌ ${template.key} (${template.orderType}:${template.triggerStatus})`);
        
        // Delete the template
        await service.deleteTemplate(template._id.toString());
        console.log(`      Deleted successfully`);
      }
    }
    
    // Verify final state
    const finalTemplates = await service.getTemplates();
    console.log(`\n✅ Cleanup complete! ${finalTemplates.length} templates remaining:`);
    finalTemplates.forEach(template => {
      console.log(`   - ${template.key} (${template.orderType}:${template.triggerStatus})`);
    });
    
    await mongoClient.close();
    console.log('\n🎉 Database cleanup completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Error during cleanup:', error);
  }
  
  process.exit(0);
}

cleanup();
