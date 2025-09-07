// Application Admin Controller
import type { Request, Response } from 'express';
export class ApplicationAdminController {
  async getInbox(req: Request, res: Response) {
    // TODO: Implement admin inbox logic
    res.json({ success: true, inbox: [] });
  }

  async processManualFNO(req: Request, res: Response) {
    // TODO: Implement manual FNO processing logic
    res.json({ success: true, message: 'Manual FNO processed (stub)' });
  }
}
