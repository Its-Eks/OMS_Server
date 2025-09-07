// Onboarding Controller
import type { Request, Response } from 'express';
export class OnboardingController {
  async startOnboarding(req: Request, res: Response) {
    // TODO: Implement onboarding start logic
    res.json({ success: true, message: 'Onboarding started (stub)' });
  }

  async getOnboardingStatus(req: Request, res: Response) {
    // TODO: Implement onboarding status retrieval logic
    res.json({ success: true, status: 'In progress (stub)' });
  }
}
