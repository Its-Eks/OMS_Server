// Admin-invited registration flow (no password here)
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';

// Domain validation
const ALLOWED_DOMAINS = (process.env.ALLOWED_DOMAINS || 'xnext.co.za,mooya.co.za')
  .split(',')
  .map(d => d.trim().toLowerCase())
  .filter(Boolean);

function validateEmailDomain(email: string): boolean {
  const atIndex = email.toLowerCase().indexOf('@');
  if (atIndex === -1 || atIndex === email.length - 1) return false;
  const domain = email.toLowerCase().slice(atIndex + 1);
  return ALLOWED_DOMAINS.includes(domain);
}

export async function registerUser(db: Pool, redis: Redis, userData: any): Promise<string> {
  const { email, firstName, lastName, roleId, roleName } = userData;
  const emailStr: string = String(email || '');
  
  console.log('Starting registration process for:', emailStr);
  
  // Validate input (admin-driven, role required, no password)
  if (!emailStr || !firstName || !lastName || (!roleId && !roleName)) {
    throw new Error('All fields are required: email, firstName, lastName, and roleId or roleName');
  }

  // Validate email domain
  if (!validateEmailDomain(emailStr)) {
    throw new Error(`Email domain not allowed. Only ${ALLOWED_DOMAINS.join(' and ')} domains are permitted.`);
  }

  // No password for admin-invited Google SSO users

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
    const existingUser = await db.query('SELECT id FROM users WHERE email = $1', [emailStr]);
    console.log('User check result:', existingUser.rows);
    
    if (existingUser.rows.length > 0) {
      throw new Error('Email already registered');
    }

    // Resolve role: accept roleId or roleName
    let resolvedRoleId: string | null = null;
    if (roleId) {
      const roleById = await db.query('SELECT id FROM roles WHERE id = $1', [roleId]);
      if (roleById.rows.length === 0) {
        throw new Error('Invalid roleId');
      }
      resolvedRoleId = roleById.rows[0].id;
    } else if (roleName) {
      const roleByName = await db.query('SELECT id FROM roles WHERE LOWER(name) = LOWER($1) LIMIT 1', [String(roleName)]);
      if (roleByName.rows.length === 0) {
        throw new Error('Invalid roleName');
      }
      resolvedRoleId = roleByName.rows[0].id;
    }

    // Dynamic INSERT based on available columns
    const availableColumns = columnsCheck.rows.map(row => row.column_name);
    
    // Build the query dynamically based on what columns exist
    let insertColumns = ['email'];
    let insertValues: any[] = [emailStr];
    let placeholders = ['$1'];
    let paramCount = 1;

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

    // Add role_id
    if (availableColumns.includes('role_id')) {
      insertColumns.push('role_id');
      insertValues.push(resolvedRoleId);
      placeholders.push(`$${++paramCount}`);
    }

    // Add is_active if column exists
    if (availableColumns.includes('is_active')) {
      insertColumns.push('is_active');
      insertValues.push(true as any);
      placeholders.push(`$${++paramCount}`);
    }

    // Add email_verified if column exists
    if (availableColumns.includes('email_verified')) {
      insertColumns.push('email_verified');
      insertValues.push(false as any);
      placeholders.push(`$${++paramCount}`);
    }

    // Add login_method if column exists
    if (availableColumns.includes('login_method')) {
      insertColumns.push('login_method');
      insertValues.push('google');
      placeholders.push(`$${++paramCount}`);
    }

    // Add timestamps if columns exist
    if (availableColumns.includes('created_at')) {
      insertColumns.push('created_at');
      insertValues.push(new Date() as any);
      placeholders.push(`$${++paramCount}`);
    }

    if (availableColumns.includes('updated_at')) {
      insertColumns.push('updated_at');
      insertValues.push(new Date() as any);
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
        email: emailStr,
        firstName,
        lastName,
        role: resolvedRoleId,
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