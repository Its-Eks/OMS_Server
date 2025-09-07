import type { Request, Response, NextFunction } from 'express';
import { AuditService } from '../services/audit.service';
import type { Pool } from 'pg';

export function auditMiddleware(action: string, resourceType: string) {
  return (req: any, res: Response, next: NextFunction) => {
    const originalSend = res.send;
    
    res.send = function(data) {
      // Log the action after response is sent
      if (res.statusCode < 400 && req.user) {
        const db: Pool = req.app.get('pgPool');
        const auditService = new AuditService(db);
        
        auditService.logAction(
          req.user.userId,
          action,
          resourceType,
          req.params.id || 'unknown',
          req.body,
          JSON.parse(data || '{}'),
          req.ip,
          req.get('User-Agent') || 'unknown'
        ).catch(err => console.error('Audit logging failed:', err));
      }
      
      return originalSend.call(this, data);
    };
    
    next();
  };
}
