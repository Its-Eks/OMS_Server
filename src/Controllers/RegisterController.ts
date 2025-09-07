import bcrypt from 'bcrypt';
import crypto from 'crypto';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';

// Domain validation
const ALLOWED_DOMAINS = ['xnext.co.za', 'mooya.co.za'];

function validateEmailDomain(email: string): boolean {
  const domain = email.toLowerCase().split('@')[1];
  return ALLOWED_DOMAINS.includes(domain);
}

export async function registerUser(db: Pool, redis: Redis, userData: any): Promise<string> {
  const { email, password, firstName, lastName } = userData;
  
  console.log('Starting registration process for:', email);
  
  // Validate input
  if (!email || !password || !firstName || !lastName) {
    throw new Error('All fields are required: email, password, firstName, lastName');
  }

  // Validate email domain
  if (!validateEmailDomain(email)) {
    throw new Error(`Email domain not allowed. Only ${ALLOWED_DOMAINS.join(' and ')} domains are permitted.`);
  }

  // Validate password strength
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters long');
  }

  try {
    // Test database connection
    const testResult = await db.query('SELECT NOW()');
    console.log('Database connection test successful:', testResult.rows[0]);

    // Check what columns exist in the users table
    const columnsCheck = await db.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND table_schema = 'public'
      ORDER BY ordinal_position;
    `);
    console.log('Available columns in users table:', columnsCheck.rows.map(row => row.column_name));

    // Check if user already exists
    console.log('Checking if user exists...');
    const existingUser = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    console.log('User check result:', existingUser.rows);
    
    if (existingUser.rows.length > 0) {
      throw new Error('Email already registered');
    }

    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Get default role (with fallback)
    let defaultRoleId = 'user';
    try {
      const roleResult = await db.query('SELECT id FROM roles WHERE name = $1 LIMIT 1', ['user']);
      if (roleResult.rows.length > 0) {
        defaultRoleId = roleResult.rows[0].id;
      }
    } catch (roleError) {
      console.warn('Roles table might not exist, using default role:', defaultRoleId);
    }

    // Dynamic INSERT based on available columns
    const availableColumns = columnsCheck.rows.map(row => row.column_name);
    
    // Build the query dynamically based on what columns exist
    let insertColumns = ['email', 'password_hash'];
    let insertValues = [email, passwordHash];
    let placeholders = ['$1', '$2'];
    let paramCount = 2;

    // Add first_name if column exists
    if (availableColumns.includes('first_name')) {
      insertColumns.push('first_name');
      insertValues.push(firstName);
      placeholders.push(`$${++paramCount}`);
    }

    // Add last_name if column exists
    if (availableColumns.includes('last_name')) {
      insertColumns.push('last_name');
      insertValues.push(lastName);
      placeholders.push(`$${++paramCount}`);
    }

    // Add role_id if column exists
    if (availableColumns.includes('role_id')) {
      insertColumns.push('role_id');
      insertValues.push(defaultRoleId);
      placeholders.push(`$${++paramCount}`);
    }

    // Add is_active if column exists
    if (availableColumns.includes('is_active')) {
      insertColumns.push('is_active');
      insertValues.push(true);
      placeholders.push(`$${++paramCount}`);
    }

    // Add email_verified if column exists
    if (availableColumns.includes('email_verified')) {
      insertColumns.push('email_verified');
      insertValues.push(false);
      placeholders.push(`$${++paramCount}`);
    }

    // Add login_method if column exists
    if (availableColumns.includes('login_method')) {
      insertColumns.push('login_method');
      insertValues.push('email');
      placeholders.push(`$${++paramCount}`);
    }

    // Add timestamps if columns exist
    if (availableColumns.includes('created_at')) {
      insertColumns.push('created_at');
      insertValues.push(new Date());
      placeholders.push(`$${++paramCount}`);
    }

    if (availableColumns.includes('updated_at')) {
      insertColumns.push('updated_at');
      insertValues.push(new Date());
      placeholders.push(`$${++paramCount}`);
    }

    // Build and execute the dynamic INSERT query
    const insertQuery = `
      INSERT INTO users (${insertColumns.join(', ')})
      VALUES (${placeholders.join(', ')})
      RETURNING id
    `;

    console.log('Executing query:', insertQuery);
    console.log('With values:', insertValues.map((val, idx) => 
      insertColumns[idx] === 'password_hash' ? '[HIDDEN]' : val
    ));

    const result = await db.query(insertQuery, insertValues);
    const userId = result.rows[0].id;
    
    console.log('User registered successfully with ID:', userId);

    // Cache user info in Redis for quick access
    try {
      const userCache = {
        id: userId,
        email,
        firstName,
        lastName,
        role: defaultRoleId,
        createdAt: new Date().toISOString()
      };
      await redis.setex(`user:${userId}`, 3600, JSON.stringify(userCache)); // Cache for 1 hour
      console.log('User cached in Redis');
    } catch (redisError) {
      console.warn('Redis caching failed:', redisError);
      // Don't fail registration if Redis fails
    }
    
    return userId;
  } catch (error: any) {
    console.error('Registration error:', error.message);
    console.error('Error stack:', error.stack);
    throw error;
  }
}

// Additional utility function to check user table structure
export async function checkUserTableStructure(db: Pool): Promise<any[]> {
  try {
    const result = await db.query(`
      SELECT 
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns 
      WHERE table_name = 'users' AND table_schema = 'public'
      ORDER BY ordinal_position;
    `);
    return result.rows;
  } catch (error) {
    console.error('Error checking table structure:', error);
    throw error;
  }
}