const Redis = require('redis');

async function testRedisConnection() {
  console.log('Testing Redis connection...');
  
  try {
    // Try to connect to Redis (assuming default localhost:6379)
    const redis = Redis.createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });
    
    redis.on('error', (err) => {
      console.log('❌ Redis connection error:', err.message);
    });
    
    redis.on('connect', () => {
      console.log('✅ Redis connected successfully');
    });
    
    await redis.connect();
    
    // Test a simple operation
    await redis.set('test_key', 'test_value');
    const value = await redis.get('test_key');
    console.log('✅ Redis read/write test successful:', value);
    
    await redis.del('test_key');
    await redis.disconnect();
    
  } catch (error) {
    console.log('❌ Redis connection failed:', error.message);
    console.log('This might be causing the analytics timeout if Redis is required for caching');
  }
}

testRedisConnection();
