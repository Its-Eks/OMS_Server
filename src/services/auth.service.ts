import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import admin from 'firebase-admin';
import { Pool } from 'pg';
import type { Redis } from 'ioredis';
import type { User } from '../models/user.model';

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
		// Restrict allowed domains
		const allowedDomains = ['xnext.co.za', 'mooya.co.za'];
		const emailDomain = decodedToken.email.split('@')[1]?.toLowerCase();
		if (!emailDomain || !allowedDomains.includes(emailDomain)) {
			throw new Error('Only Xnext.co.za and Mooya.co.za email domains are allowed.');
		}
		// Check if user exists
		let user = await this.findUserByFirebaseUid(decodedToken.uid);
		if (!user) {
			// Check if user exists with same email but no Firebase UID
			const existingUser = await this.findUserByEmail(decodedToken.email);
			if (existingUser) {
				user = await this.linkFirebaseAccount(existingUser.id, decodedToken);
			} else {
				user = await this.createUserFromGoogle(decodedToken);
			}
		} else {
			await this.updateLastLogin(user.id);
		}
		// Generate JWT tokens
		const tokens = await this.generateTokens(user, deviceInfo, ipAddress);
		return { user, tokens };
	}

	// Email/password authentication
	async authenticateWithEmail(email: string, password: string, deviceInfo?: any, ipAddress?: string): Promise<{ user: User; tokens: AuthTokens }> {
		// Find user by email
		const user = await this.findUserByEmail(email);
		if (!user) {
			throw new Error('User not found');
		}
		if (!user.password_hash) {
			throw new Error('User registered with Google. Please use Google sign-in.');
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

	// Generate access and refresh tokens
	private async generateTokens(user: User, deviceInfo?: any, ipAddress?: string): Promise<AuthTokens> {
		const accessTokenPayload = {
			userId: user.id,
			email: user.email,
			role: user.roleId,
			permissions: [], // TODO: fetch permissions from role
		};
		const jwtSecret = process.env.JWT_SECRET!;
		const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET!;
		const accessToken = jwt.sign(
			{ ...accessTokenPayload, tokenType: 'access' },
			jwtSecret,
			{ expiresIn: process.env.JWT_EXPIRES_IN || '4h', issuer: 'isp-oms', audience: 'isp-oms-users' }
		);
		const refreshToken = jwt.sign(
			{ ...accessTokenPayload, tokenType: 'refresh' },
			jwtRefreshSecret,
			{ expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d', issuer: 'isp-oms', audience: 'isp-oms-users' }
		);
		// Store refresh token in DB
		const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
		const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
		await this.db.query(
			`INSERT INTO refresh_tokens (user_id, token_hash, expires_at, device_info, ip_address) VALUES ($1, $2, $3, $4, $5)`,
			[user.id, refreshTokenHash, expiresAt, JSON.stringify(deviceInfo), ipAddress]
		);
		// Store session in Redis
		await this.redis.setex(
			`session:${user.id}`,
			3600,
			JSON.stringify({ userId: user.id, email: user.email, role: user.roleId, permissions: [], lastActivity: Date.now() })
		);
		return { accessToken, refreshToken, expiresIn: 15 * 60 };
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
}
