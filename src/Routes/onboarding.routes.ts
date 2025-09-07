import { Router } from 'express';
// TODO: Import onboarding controller functions
const router = Router();

router.post('/start', (req, res) => res.json({ success: true, message: 'Onboarding started (stub)' }));
router.put('/progress', (req, res) => res.json({ success: true, message: 'Onboarding progress updated (stub)' }));
router.get('/status/:customerId', (req, res) => res.json({ success: true, status: 'In progress (stub)' }));

export default router;
