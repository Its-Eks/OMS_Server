// FNO Controller
import type { Request, Response } from 'express';
import type { Pool } from 'pg';

export class FNOController {
  async list(req: Request, res: Response) {
    try {
      const db: Pool = req.app.get('pgPool');
      const result = await db.query(`
        SELECT id, name, code, api_endpoint, portal_url,
               integration_type, coverage_areas, is_active, created_at
        FROM fnos
        ORDER BY name ASC
      `);
      res.json({ success: true, fnos: result.rows });
    } catch (e: any) {
      res.status(500).json({ success: false, error: { message: e.message } });
    }
  }

  async getById(req: Request, res: Response) {
    try {
      const db: Pool = req.app.get('pgPool');
      const result = await db.query(`
        SELECT id, name, code, api_endpoint, portal_url,
               integration_type, coverage_areas, is_active, created_at
        FROM fnos WHERE id = $1
      `, [req.params.id]);
      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: { message: 'FNO not found' } });
      }
      res.json({ success: true, fno: result.rows[0] });
    } catch (e: any) {
      res.status(500).json({ success: false, error: { message: e.message } });
    }
  }

  async listActive(req: Request, res: Response) {
    try {
      const db: Pool = req.app.get('pgPool');
      const result = await db.query(`
        SELECT id, name, code, api_endpoint, portal_url,
               integration_type, coverage_areas, is_active, created_at
        FROM fnos WHERE is_active = TRUE
        ORDER BY name ASC
      `);
      res.json({ success: true, fnos: result.rows });
    } catch (e: any) {
      res.status(500).json({ success: false, error: { message: e.message } });
    }
  }

  async submitOrder(req: Request, res: Response) {
    // TODO: Implement FNO order submission logic
    res.json({ success: true, message: 'Order submitted to FNO (stub)' });
  }

  async getFNOStatus(req: Request, res: Response) {
    // TODO: Implement FNO status retrieval logic
    res.json({ success: true, status: 'In progress (stub)' });
  }
}
