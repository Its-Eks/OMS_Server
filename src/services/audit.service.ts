import { Pool } from 'pg';

export class AuditService {
  private db: Pool;
  constructor(db: Pool) {
    this.db = db;
  }

  async logAction(userId: string, action: string, resourceType: string, resourceId: string, oldValues: any, newValues: any, ipAddress: string, userAgent: string) {
    await this.db.query(
      `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, old_values, new_values, ip_address, user_agent, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [userId, action, resourceType, resourceId, JSON.stringify(oldValues), JSON.stringify(newValues), ipAddress, userAgent]
    );
  }

  async getAuditLogs(limit: number = 100) {
    const result = await this.db.query(
      'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    return result.rows;
  }
}
