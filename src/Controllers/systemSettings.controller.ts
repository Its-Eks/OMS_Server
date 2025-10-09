import type { Request, Response } from 'express';
import type { MongoClient, Db } from 'mongodb';
import type { Pool } from 'pg';

function getDb(req: Request): Db {
	const client: MongoClient | undefined = req.app.get('mongoClient');
	if (!client) {
		throw new Error('MongoDB client not available');
	}
	return client.db(process.env.MONGO_DB_NAME || 'oms_db');
}

function getPgPool(req: Request): Pool {
	const pool: Pool | undefined = req.app.get('pgPool');
	if (!pool) {
		throw new Error('PostgreSQL pool not available');
	}
	return pool;
}

function safeDiff(prevValue: any, nextValue: any) {
	try {
		return { before: prevValue ?? null, after: nextValue ?? null };
	} catch {
		return null;
	}
}

function deepMerge(target: any, source: any): any {
	if (Array.isArray(target) || Array.isArray(source)) {
		return source; // arrays: replace
	}
	if (typeof target !== 'object' || target === null) return source;
	if (typeof source !== 'object' || source === null) return source;
	const out: any = { ...target };
	for (const key of Object.keys(source)) {
		const srcVal = source[key];
		const tgtVal = (target as any)[key];
		if (srcVal && typeof srcVal === 'object' && !Array.isArray(srcVal)) {
			out[key] = deepMerge(tgtVal, srcVal);
		} else {
			out[key] = srcVal;
		}
	}
	return out;
}

function getDefaultsByKey(key: string): any {
  switch (key) {
    case 'escalation':
      return {
        sla: {
          pendingHours: 24,
          breachEscalationLevels: [
            { level: 1, minutes: 48 * 60 },
            { level: 2, minutes: 72 * 60 },
          ],
        },
        recipients: { defaultRoles: [], fallbackUserIds: [] },
        rules: { autoEscalate: true, timeBased: true, hierarchical: true },
        notifications: { enabled: true, channels: ['inApp', 'email'] },
      };
    case 'trials':
      return {
        trialDays: 30,
        remindersDays: [7, 14, 21, 28],
        conversion: { autoCampaigns: true, segments: [] },
        metrics: { trackEngagement: true },
      };
    case 'notifications':
      return {
        email: { enabled: true, from: 'noreply@xnext.co.za' },
        smtp: { host: '', port: 587, user: '', secure: false },
        inApp: { retentionDays: 30, badgeBehavior: 'unreadOnly' },
        broadcast: { allowSystemWide: true, restrictedRoles: [] },
      };
    case 'system':
      return {
        security: { jwtExpiresMinutes: 60, rateLimit: { windowSeconds: 60, maxRequests: 100 } },
        branding: { appName: 'OMS Platform', logoUrl: '' },
        features: { enableOnboarding: true, enableEscalations: true, enableFnoApi: true },
      };
    case 'rbac':
      return {
        permissions: {
          adminCanManageUsers: true,
          managerCanViewReports: true,
          userCanCreateOrders: true,
        },
        security: {
          requireMfaForAdmins: true,
          allowRoleEscalation: false,
          maxConcurrentSessions: 3,
        },
      };
    default:
      return {};
  }
}

function normalizeByKey(key: string, value: any): any {
  const v = value || {};
  if (key === 'trials') {
    const days = Array.isArray(v.remindersDays)
      ? v.remindersDays
      : String(v.remindersDays || '')
          .split(',')
          .map((d: string) => parseInt(String(d).trim(), 10))
          .filter((n: number) => Number.isFinite(n));
    return {
      trialDays: Number(v.trialDays) || 30,
      remindersDays: days,
      conversion: { autoCampaigns: !!(v.conversion?.autoCampaigns), segments: v.conversion?.segments || [] },
      metrics: { trackEngagement: true },
    };
  }
  if (key === 'notifications') {
    return {
      email: { enabled: !!(v.email?.enabled), from: v.email?.from || 'noreply@isp.co.za' },
      smtp: {
        host: v.smtp?.host || '',
        port: Number(v.smtp?.port) || 587,
        user: v.smtp?.user || '',
        secure: !!(v.smtp?.secure),
      },
      inApp: { retentionDays: Number(v.inApp?.retentionDays) || 30, badgeBehavior: v.inApp?.badgeBehavior || 'unreadOnly' },
      broadcast: { allowSystemWide: v.broadcast?.allowSystemWide !== false, restrictedRoles: v.broadcast?.restrictedRoles || [] },
    };
  }
  if (key === 'system') {
    return {
      security: {
        jwtExpiresMinutes: Number(v.security?.jwtExpiresMinutes) || 60,
        rateLimit: {
          windowSeconds: Number(v.security?.rateLimit?.windowSeconds) || 60,
          maxRequests: Number(v.security?.rateLimit?.maxRequests) || 100,
        },
      },
      branding: { appName: v.branding?.appName || 'OMS Platform', logoUrl: v.branding?.logoUrl || '' },
      features: {
        enableOnboarding: v.features?.enableOnboarding !== false,
        enableEscalations: v.features?.enableEscalations !== false,
        enableFnoApi: v.features?.enableFnoApi !== false,
      },
      maintenanceMode: !!(v.maintenanceMode),
      debugLogging: !!(v.debugLogging),
    };
  }
  if (key === 'rbac') {
    return {
      permissions: {
        adminCanManageUsers: !!(v.permissions?.adminCanManageUsers),
        managerCanViewReports: !!(v.permissions?.managerCanViewReports),
        userCanCreateOrders: !!(v.permissions?.userCanCreateOrders),
      },
      security: {
        requireMfaForAdmins: !!(v.security?.requireMfaForAdmins),
        allowRoleEscalation: !!(v.security?.allowRoleEscalation),
        maxConcurrentSessions: Number(v.security?.maxConcurrentSessions) || 3,
      },
    };
  }
  if (key === 'escalation') {
    // Ensure minutes are numbers and rules are booleans
    const pendingHours = Number(v.sla?.pendingHours) || 24;
    const levels = Array.isArray(v.sla?.breachEscalationLevels) ? v.sla.breachEscalationLevels : [];
    const lvl0 = Number(levels?.[0]?.minutes) || 48 * 60;
    const lvl1 = Number(levels?.[1]?.minutes) || 72 * 60;
    return {
      sla: {
        pendingHours,
        breachEscalationLevels: [
          { level: 1, minutes: lvl0 },
          { level: 2, minutes: lvl1 },
        ],
      },
      recipients: {
        defaultRoles: Array.isArray(v.recipients?.defaultRoles) ? v.recipients.defaultRoles : [],
        fallbackUserIds: Array.isArray(v.recipients?.fallbackUserIds) ? v.recipients.fallbackUserIds : [],
      },
      rules: {
        autoEscalate: !!(v.rules?.autoEscalate),
        timeBased: v.rules?.timeBased !== false,
        hierarchical: v.rules?.hierarchical !== false,
      },
      notifications: {
        enabled: v.notifications?.enabled !== false,
        channels: Array.isArray(v.notifications?.channels) ? v.notifications.channels : ['inApp', 'email'],
      },
    };
  }
  return v;
}

async function applyEscalationToSlaPolicies(pgPool: Pool, escalationValue: any): Promise<void> {
  try {
    const defaultHours = Number(escalationValue?.sla?.pendingHours) || 24;
    const warnPct = 0.75;
    const reescalatePct = 1.5;

    // Allow per-priority multipliers via settings overrides
    const defaultMultipliers: Record<string, number> = {
      normal: 1.0,
      high: 0.5,
      urgent: 0.25,
    };
    const overrideMultipliers: Record<string, number> = (escalationValue?.sla?.priorityMultipliers as Record<string, number>) || {};

    // Read existing priorities from DB to target correct label set
    const distinct = await pgPool.query("SELECT DISTINCT LOWER(priority) AS p FROM public.sla_policies");
    const priorities: string[] = distinct.rows.map((r: any) => String(r.p));

    console.log('[systemSettings] Propagating escalation to sla_policies', {
      defaultHours, warnPct, reescalatePct, priorities, overrideMultipliers
    });

    const results: Record<string, number> = {};
    for (const p of priorities) {
      const m = Number.isFinite(overrideMultipliers[p]) ? Number(overrideMultipliers[p]) : (defaultMultipliers[p] ?? 1.0);
      const hours = Math.max(Math.round(defaultHours * m), 1);
      const res = await pgPool.query(
        `UPDATE public.sla_policies
         SET sla_hours = $1, warn_threshold_pct = $2, reescalate_threshold_pct = $3, updated_at = NOW()
         WHERE LOWER(priority) = $4`,
        [hours, warnPct, reescalatePct, p]
      );
      results[p] = res.rowCount || 0;
    }

    console.log('[systemSettings] sla_policies updated', results);
  } catch (err) {
    // Do not fail the settings save due to SLA propagation; log for operators
    console.error('[systemSettings] Failed to apply escalation to sla_policies:', (err as any)?.message);
  }
}

async function enrichWithUserNames(pgPool: Pool, settings: any[]): Promise<any[]> {
	if (!settings.length) return settings;
	
	// Get unique user IDs from the settings
	const userIds = [...new Set(settings.map(s => s.updatedBy).filter(Boolean))];
	
	if (userIds.length === 0) return settings;
	
	// Fetch user names from the users table (PostgreSQL)
	const placeholders = userIds.map((_, index) => `$${index + 1}`).join(',');
	const query = `
		SELECT id, first_name, last_name, email 
		FROM users 
		WHERE id IN (${placeholders})
	`;
	
	const result = await pgPool.query(query, userIds);
	const users = result.rows;
	
	// Create a map of user ID to user info
	const userMap = new Map();
	users.forEach(user => {
		const fullName = user.first_name && user.last_name 
			? `${user.first_name} ${user.last_name}`.trim()
			: user.first_name || user.last_name || user.email || user.id;
		
		userMap.set(user.id, {
			id: user.id,
			name: fullName,
			email: user.email
		});
	});
	
	// Enrich settings with user names
	return settings.map(setting => ({
		...setting,
		updatedBy: userMap.get(setting.updatedBy) || {
			id: setting.updatedBy,
			name: setting.updatedBy,
			email: null
		}
	}));
}

export const SystemSettingsController = {
	list: async (req: Request, res: Response) => {
		try {
			const db = getDb(req);
			const pgPool = getPgPool(req);
			const keys = String(req.query.keys || '')
				.split(',')
				.map(k => k.trim())
				.filter(Boolean);
			const filter = keys.length ? { key: { $in: keys } } : {};
			const docs = await db.collection('system_settings').find(filter).toArray();
			const settings = docs.map(({ _id, ...d }) => d);
			// Backfill defaults for requested keys that are missing
			const existingKeys = new Set(settings.map((s: any) => s.key));
			for (const k of (keys.length ? keys : [])) {
				if (!existingKeys.has(k)) {
					settings.push({ key: k, value: getDefaultsByKey(k), version: 0 });
				}
			}
			const enrichedSettings = await enrichWithUserNames(pgPool, settings);
			res.json({ success: true, data: enrichedSettings });
		} catch (e: any) {
			res.status(500).json({ success: false, error: e.message });
		}
	},

	getOne: async (req: Request, res: Response) => {
		try {
			const db = getDb(req);
			const pgPool = getPgPool(req);
			const { key } = req.params as { key: string };
			if (!key) return res.status(400).json({ success: false, error: 'key is required' });
			const doc = await db.collection('system_settings').findOne({ key });
			if (!doc) return res.json({ success: true, data: { key, value: getDefaultsByKey(key), version: 0 } });
			const { _id, ...rest } = doc as any;
			const enrichedSettings = await enrichWithUserNames(pgPool, [rest]);
			res.json({ success: true, data: enrichedSettings[0] });
		} catch (e: any) {
			res.status(500).json({ success: false, error: e.message });
		}
	},

	validate: async (req: Request, res: Response) => {
		try {
			const { key } = req.body || {};
			if (!key) return res.status(400).json({ success: false, error: 'key is required' });
			// Placeholder: schemas can be added later; always accept for now
			res.json({ success: true, valid: true });
		} catch (e: any) {
			res.status(500).json({ success: false, error: e.message });
		}
	},

	upsert: async (req: Request, res: Response) => {
		try {
			const db = getDb(req);
			const pgPool = getPgPool(req);
			const { key } = req.params as { key: string };
			const { value, version } = req.body || {};
			if (!key || typeof value === 'undefined') {
				return res.status(400).json({ success: false, error: 'key and value are required' });
			}
			const coll = db.collection('system_settings');
			const current: any = await coll.findOne({ key });
			const nextVersion = (current?.version || 0) + 1;
			if (typeof version !== 'undefined' && current && version < current.version) {
				return res.status(409).json({ success: false, error: 'version_conflict', current: { key: current.key, value: current.value, version: current.version } });
			}
			const updatedBy = ((req as any).user?.userId || (req as any).user?.email || 'system');
			const updatedAt = new Date();
			const normalized = normalizeByKey(key, deepMerge(getDefaultsByKey(key), value));
			await coll.updateOne(
				{ key },
				{ $set: { key, value: normalized, version: nextVersion, updatedBy, updatedAt } },
				{ upsert: true }
			);
			// Side-effect: propagate escalation defaults into sla_policies
			if (key === 'escalation') {
				await applyEscalationToSlaPolicies(pgPool, normalized);
			}
			await db.collection('system_settings_audit').insertOne({
				key,
				prevValue: current?.value ?? null,
				nextValue: normalized,
				prevVersion: current?.version ?? 0,
				nextVersion: nextVersion,
				diff: safeDiff(current?.value ?? null, normalized),
				updatedBy,
				updatedAt,
			});
			const enrichedSettings = await enrichWithUserNames(pgPool, [{ key, value: normalized, version: nextVersion, updatedBy, updatedAt }]);
			res.json({ success: true, data: enrichedSettings[0] });
		} catch (e: any) {
			res.status(500).json({ success: false, error: e.message });
		}
	},

	patch: async (req: Request, res: Response) => {
		try {
			const db = getDb(req);
			const pgPool = getPgPool(req);
			const { key } = req.params as { key: string };
			const { valuePatch, version } = req.body || {};
			if (!key || typeof valuePatch === 'undefined' || typeof version !== 'number') {
				return res.status(400).json({ success: false, error: 'key, valuePatch and version are required' });
			}
			const coll = db.collection('system_settings');
			const current: any = await coll.findOne({ key });
			if (!current) {
				return res.status(404).json({ success: false, error: 'not_found' });
			}
			if (version < current.version) {
				return res.status(409).json({ success: false, error: 'version_conflict', current: { key: current.key, value: current.value, version: current.version } });
			}
			const merged = normalizeByKey(key, deepMerge(deepMerge(getDefaultsByKey(key), current.value ?? {}), valuePatch));
			const nextVersion = current.version + 1;
			const updatedBy = ((req as any).user?.userId || (req as any).user?.email || 'system');
			const updatedAt = new Date();
			await coll.updateOne(
				{ key },
				{ $set: { key, value: merged, version: nextVersion, updatedBy, updatedAt } }
			);
			if (key === 'escalation') {
				await applyEscalationToSlaPolicies(pgPool, merged);
			}
			await db.collection('system_settings_audit').insertOne({
				key,
				prevValue: current.value,
				nextValue: merged,
				prevVersion: current.version,
				nextVersion: nextVersion,
				diff: safeDiff(current.value, merged),
				updatedBy,
				updatedAt,
			});
			const enrichedSettings = await enrichWithUserNames(pgPool, [{ key, value: merged, version: nextVersion, updatedBy, updatedAt }]);
			res.json({ success: true, data: enrichedSettings[0] });
		} catch (e: any) {
			res.status(500).json({ success: false, error: e.message });
		}
	},

	audit: async (req: Request, res: Response) => {
		try {
			const db = getDb(req);
			const pgPool = getPgPool(req);
			const { key } = req.params as { key: string };
			const limit = Math.min(parseInt(String(req.query.limit || '20'), 10), 100);
			
			// Get current setting to determine current version
			const currentSetting = await db.collection('system_settings').findOne({ key });
			const currentVersion = currentSetting?.version || 0;
			
			const rows = await db.collection('system_settings_audit')
				.find({ key })
				.sort({ updatedAt: -1 })
				.limit(limit)
				.toArray();
			
			// Get unique user IDs from the audit entries
			const userIds = [...new Set(rows.map(row => row.updatedBy).filter(Boolean))];
			
			// Create a map of user ID to user name (populate only if we have IDs)
			const userMap = new Map<string, string>();
			if (userIds.length > 0) {
				const placeholders = userIds.map((_, index) => `$${index + 1}`).join(',');
				const query = `
					SELECT id, first_name, last_name, email 
					FROM users 
					WHERE id IN (${placeholders})
				`;
				try {
					const result = await pgPool.query(query, userIds);
					const users = result.rows;
					users.forEach((user: any) => {
						const fullName = user.first_name && user.last_name 
							? `${user.first_name} ${user.last_name}`.trim()
							: user.first_name || user.last_name || user.email || user.id;
						userMap.set(user.id, fullName);
					});
				} catch (e) {
					// If name enrichment fails, continue with IDs
				}
			}
			
			// Map audit entries with enhanced information
			const enrichedRows = rows.map(({ _id, ...r }) => {
				const isCurrentVersion = r.nextVersion === currentVersion;
				const isRollback = r.prevVersion > r.nextVersion;
				const changeType = isRollback ? 'rollback' : 
								  r.prevVersion === 0 ? 'created' : 
								  'updated';
				
				return {
					...r,
					updatedByName: userMap.get(r.updatedBy) || r.updatedBy,
					isCurrentVersion,
					changeType,
					isRollback
				};
			});
			
			res.json({ 
				success: true, 
				data: {
					auditEntries: enrichedRows,
					currentVersion,
					totalEntries: rows.length
				}
			});
		} catch (e: any) {
			res.status(500).json({ success: false, error: e.message });
		}
	},

	rollback: async (req: Request, res: Response) => {
		try {
			const db = getDb(req);
			const pgPool = getPgPool(req);
			const { key } = req.params as { key: string };
			const { toVersion } = req.body || {};
			if (!key || typeof toVersion !== 'number') {
				return res.status(400).json({ success: false, error: 'key and toVersion are required' });
			}
			const coll = db.collection('system_settings');
			const current: any = await coll.findOne({ key });
			if (!current) return res.status(404).json({ success: false, error: 'not_found' });
			const audit = await db.collection('system_settings_audit').findOne({ key, nextVersion: toVersion });
			if (!audit) return res.status(404).json({ success: false, error: 'audit_version_not_found' });
			const nextValue = normalizeByKey(key, deepMerge(getDefaultsByKey(key), (audit as any).nextValue));
			const nextVersion = current.version + 1;
			const updatedBy = ((req as any).user?.userId || (req as any).user?.email || 'system');
			const updatedAt = new Date();
			await coll.updateOne(
				{ key },
				{ $set: { key, value: nextValue, version: nextVersion, updatedBy, updatedAt } }
			);
			if (key === 'escalation') {
				await applyEscalationToSlaPolicies(pgPool, nextValue);
			}
			await db.collection('system_settings_audit').insertOne({
				key,
				prevValue: current.value,
				nextValue,
				prevVersion: current.version,
				nextVersion,
				diff: safeDiff(current.value, nextValue),
				updatedBy,
				updatedAt,
			});
			const enrichedSettings = await enrichWithUserNames(pgPool, [{ key, value: nextValue, version: nextVersion, updatedBy, updatedAt }]);
			res.json({ success: true, data: enrichedSettings[0] });
		} catch (e: any) {
			res.status(500).json({ success: false, error: e.message });
		}
	},
};

export default SystemSettingsController;


