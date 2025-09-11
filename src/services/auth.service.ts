import jwt, { type Secret, type SignOptions } from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import admin from 'firebase-admin';
import { Pool } from 'pg';
import type { Redis } from 'ioredis';
// Local user type to avoid path resolution issues during linting
interface User {
  id: string;
  email: string;
  password_hash?: string;
  roleId?: string;
  role_id?: string;
  // Joined fields
  role_name?: string;
  role_permissions?: string[];
}
import dotenv from 'dotenv';
dotenv.config();

export interface AuthTokens {
	accessToken: string;
	refreshToken: string;
	expiresIn: number;
}

export class AuthService {
	private db: Pool;
	private redis: Redis;

	constructor(db: Pool, redis: Redis) {
		this.db = db;
		this.redis = redis;
	}

	// Google OAuth authentication with Firebase
	async authenticateWithGoogle(firebaseToken: string, deviceInfo?: any, ipAddress?: string): Promise<{ user: User; tokens: AuthTokens }> {
		// Verify Firebase ID token
		const decodedToken = await admin.auth().verifyIdToken(firebaseToken);
		if (!decodedToken.email || !decodedToken.email_verified) {
			throw new Error('Email not verified or missing');
		}
		// Restrict allowed domains (configurable)
		const allowedDomains = (process.env.ALLOWED_DOMAINS || 'xnext.co.za,mooya.co.za')
			.split(',')
			.map(d => d.trim().toLowerCase())
			.filter(Boolean);
		const emailDomain = decodedToken.email.split('@')[1]?.toLowerCase();
		if (!emailDomain || !allowedDomains.includes(emailDomain)) {
			throw new Error('Only Xnext.co.za and Mooya.co.za email domains are allowed.');
		}
		// Check if user is pre-registered in PostgreSQL
		const existingUser = await this.findUserByEmail(decodedToken.email);
		if (!existingUser) {
			throw new Error('Account not found. Please contact your system administrator.');
		}
		// Optionally link Firebase UID if not linked
		let user = existingUser;
		if (!(existingUser as any).firebase_uid && decodedToken.uid) {
			user = await this.linkFirebaseAccount(existingUser.id, decodedToken);
		}
		await this.updateLastLogin(user.id);
		// Generate JWT tokens
		const tokens = await this.generateTokens(user, deviceInfo, ipAddress);
		return { user, tokens };
	}

	// Email/password authentication
	async authenticateWithEmail(email: string, password: string, deviceInfo?: any, ipAddress?: string): Promise<{ user: User; tokens: AuthTokens }> {
		// Find user by email (join role)
		const result = await this.db.query(
			`SELECT u.*, r.name AS role_name, r.permissions AS role_permissions
			 FROM users u
			 LEFT JOIN roles r ON r.id = u.role_id
			 WHERE u.email = $1 LIMIT 1`,
			[email]
		);
		const user = result.rows[0];
		if (!user) {
			throw new Error('User not found');
		}
		// Enforce active account and verified email
		if (user.is_active === false) {
			throw new Error('Account is inactive');
		}
		if (user.email_verified === false) {
			throw new Error('Email not verified');
		}
		
		// If no password set, allow login and return special flag
		if (!user.password_hash) {
			// Update last login
			await this.updateLastLogin(user.id);
			// Generate tokens
			const tokens = await this.generateTokens(user, deviceInfo, ipAddress);
			return { user: { ...user, needsPasswordSetup: true }, tokens };
		}
		
		// Verify password
		const valid = await bcrypt.compare(password, user.password_hash);
		if (!valid) {
			throw new Error('Invalid password');
		}
		// Update last login
		await this.updateLastLogin(user.id);
		// Generate tokens
		const tokens = await this.generateTokens(user, deviceInfo, ipAddress);
		return { user, tokens };
	}

	// Generate access and refresh tokens - include role name and permissions
	private async generateTokens(user: User, deviceInfo?: any, ipAddress?: string): Promise<AuthTokens> {
		// Load role name and permissions
		let roleName = 'user';
		let rolePermissions: string[] = [];
		if ((user as any).role_name && Array.isArray((user as any).role_permissions)) {
			roleName = (user as any).role_name;
			rolePermissions = (user as any).role_permissions;
		} else if ((user as any).roleid || (user as any).role_id) {
			const roleId = (user as any).roleid || (user as any).role_id || (user as any).roleId;
			if (roleId) {
				const roleRes = await this.db.query('SELECT name, permissions FROM roles WHERE id = $1 LIMIT 1', [roleId]);
				if (roleRes.rows[0]) {
					roleName = roleRes.rows[0].name || roleName;
					rolePermissions = Array.isArray(roleRes.rows[0].permissions) ? roleRes.rows[0].permissions : [];
				}
			}
		}

		const accessTokenPayload = {
			userId: user.id,
			email: user.email,
			role: roleName,
			permissions: rolePermissions,
		};
		
		const jwtSecret = process.env.JWT_SECRET;
		const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
		
		if (!jwtSecret) {
			throw new Error('JWT_SECRET environment variable is required');
		}
		
		const accessExpires: any = process.env.JWT_EXPIRES_IN || '4h';
		const accessOptions: SignOptions = { expiresIn: accessExpires as any, issuer: 'isp-oms', audience: 'isp-oms-users' };
		const signingKey: any = jwtSecret as any;
		const accessToken = (jwt as any).sign(
			{ ...accessTokenPayload, tokenType: 'access' },
			signingKey,
			accessOptions
		);
		
		const refreshExpires: any = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
		const refreshOptions: SignOptions = { expiresIn: refreshExpires as any, issuer: 'isp-oms', audience: 'isp-oms-users' };
		const refreshSigningKey: any = jwtRefreshSecret as any;
		const refreshToken = (jwt as any).sign(
			{ ...accessTokenPayload, tokenType: 'refresh' },
			refreshSigningKey,
			refreshOptions
		);

		// Generate unique token ID for this session
		const tokenId = crypto.randomBytes(16).toString('hex');
		const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
		const now = new Date();
		const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

		try {
			// ✅ FIXED: Store refresh token in REDIS instead of PostgreSQL
			const refreshTokenData = {
				userId: user.id,
				tokenId,
				tokenHash: refreshTokenHash,
				deviceInfo: deviceInfo || {},
				ipAddress: ipAddress || 'unknown',
				createdAt: now.toISOString(),
				expiresAt: expiresAt.toISOString(),
				isRevoked: false
			};

			// Store refresh token with 7 day expiration
			const refreshTokenKey = `refresh_token:${user.id}:${tokenId}`;
			
			// Try different Redis method signatures
			if (typeof this.redis.setex === 'function') {
				await this.redis.setex(
					refreshTokenKey,
					7 * 24 * 60 * 60, // 7 days in seconds
					JSON.stringify(refreshTokenData)
				);
			} else if (typeof this.redis.set === 'function') {
				await this.redis.set(
					refreshTokenKey,
					JSON.stringify(refreshTokenData),
					'EX',
					7 * 24 * 60 * 60 // 7 days in seconds
				);
			} else {
				throw new Error('Redis set method not available');
			}

			// Store in user's active tokens set
			const userTokensKey = `user_tokens:${user.id}`;
			if (typeof this.redis.sadd === 'function') {
				await this.redis.sadd(userTokensKey, tokenId);
				await this.redis.expire(userTokensKey, 7 * 24 * 60 * 60); // 7 days
			}

			// ✅ Store session in Redis (keeping your existing session logic)
			if (typeof this.redis.setex === 'function') {
				await this.redis.setex(
					`session:${user.id}`,
					4 * 60 * 60, // 4 hours to match access token
					JSON.stringify({ 
						userId: user.id, 
						email: user.email, 
						role: roleName, 
						permissions: rolePermissions, 
						lastActivity: Date.now(),
						tokenId 
					})
				);
			} else if (typeof this.redis.set === 'function') {
				await this.redis.set(
					`session:${user.id}`,
					JSON.stringify({ 
						userId: user.id, 
						email: user.email, 
						role: roleName, 
						permissions: rolePermissions, 
						lastActivity: Date.now(),
						tokenId 
					}),
					'EX',
					4 * 60 * 60 // 4 hours
				);
			}

			console.log(`✅ Tokens stored in Redis for user: ${user.id}`);

		} catch (redisError) {
			console.error('❌ Redis token storage failed:', redisError);
			console.error('Redis object methods:', Object.getOwnPropertyNames(this.redis));
			throw new Error('Failed to store authentication tokens');
		}

		return { 
			accessToken, 
			refreshToken, 
			expiresIn: 4 * 60 * 60 // 4 hours in seconds
		};
	}

	// Add method to refresh tokens using Redis
	async refreshAccessToken(refreshToken: string): Promise<AuthTokens> {
		try {
			const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
			if (!jwtRefreshSecret) {
				throw new Error('JWT refresh secret not configured');
			}

			// Verify refresh token
			const decoded = jwt.verify(refreshToken, jwtRefreshSecret) as any;
			const userId = decoded.userId;

			// Check if refresh token exists in Redis
			const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
			const userTokensKey = `user_tokens:${userId}`;
			const tokenIds = await this.redis.smembers(userTokensKey);

			let validTokenFound = false;
			for (const tokenId of tokenIds) {
				const refreshTokenKey = `refresh_token:${userId}:${tokenId}`;
				const tokenDataStr = await this.redis.get(refreshTokenKey);
				
				if (tokenDataStr) {
					const tokenData = JSON.parse(tokenDataStr);
					if (tokenData.tokenHash === refreshTokenHash && !tokenData.isRevoked) {
						validTokenFound = true;
						break;
					}
				}
			}

			if (!validTokenFound) {
				throw new Error('Invalid or expired refresh token');
			}

			// Get user from database
			const user = await this.findUserById(userId);
			if (!user) {
				throw new Error('User not found');
			}

			// Generate new tokens
			const tokens = await this.generateTokens(user);
			return tokens;

		} catch (error) {
			console.error('Token refresh error:', error);
			throw new Error('Failed to refresh token');
		}
	}

	// Add method to revoke tokens
	async revokeUserTokens(userId: string, tokenId?: string): Promise<void> {
		try {
			if (tokenId) {
				// Revoke specific token
				const refreshTokenKey = `refresh_token:${userId}:${tokenId}`;
				await this.redis.del(refreshTokenKey);
				await this.redis.srem(`user_tokens:${userId}`, tokenId);
			} else {
				// Revoke all tokens for user
				const userTokensKey = `user_tokens:${userId}`;
				const tokenIds = await this.redis.smembers(userTokensKey);
				
				const keysToDelete = [userTokensKey, `session:${userId}`];
				for (const id of tokenIds) {
					keysToDelete.push(`refresh_token:${userId}:${id}`);
				}
				
				if (keysToDelete.length > 0) {
					await this.redis.del(...keysToDelete);
				}
			}
			
			console.log(`✅ Revoked tokens for user: ${userId}`);
		} catch (error) {
			console.error('Token revocation error:', error);
		}
	}

	// Helper: find user by Firebase UID
	private async findUserByFirebaseUid(uid: string): Promise<User | null> {
		const result = await this.db.query('SELECT * FROM users WHERE firebase_uid = $1', [uid]);
		return result.rows[0] || null;
	}

	// Helper: find user by email
	private async findUserByEmail(email: string): Promise<User | null> {
		const result = await this.db.query('SELECT * FROM users WHERE email = $1', [email]);
		return result.rows[0] || null;
	}

	// Helper: find user by ID
	private async findUserById(id: string): Promise<User | null> {
		const result = await this.db.query(
			`SELECT u.*, r.name AS role_name, r.permissions AS role_permissions
			 FROM users u
			 LEFT JOIN roles r ON r.id = u.role_id
			 WHERE u.id = $1 LIMIT 1`,
			[id]
		);
		return result.rows[0] || null;
	}

	// Helper: link Firebase account
	private async linkFirebaseAccount(userId: string, decodedToken: any): Promise<User> {
		await this.db.query('UPDATE users SET firebase_uid = $1 WHERE id = $2', [decodedToken.uid, userId]);
		return (await this.findUserByFirebaseUid(decodedToken.uid))!;
	}

	// Helper: create user from Google
	private async createUserFromGoogle(decodedToken: any): Promise<User> {
		const result = await this.db.query(
			`INSERT INTO users (email, first_name, last_name, firebase_uid, email_verified, is_active, login_method) VALUES ($1, $2, $3, $4, $5, true, 'google') RETURNING *`,
			[decodedToken.email, decodedToken.name?.split(' ')[0] || '', decodedToken.name?.split(' ')[1] || '', decodedToken.uid, true]
		);
		return result.rows[0];
	}

	// Helper: update last login
	private async updateLastLogin(userId: string): Promise<void> {
		await this.db.query('UPDATE users SET updated_at = NOW() WHERE id = $1', [userId]);
	}

	// Set password for user (for users who logged in without password)
	async setUserPassword(userId: string, newPassword: string): Promise<void> {
		const saltRounds = 12;
		const passwordHash = await bcrypt.hash(newPassword, saltRounds);
		
		await this.db.query(
			'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
			[passwordHash, userId]
		);
	}
}