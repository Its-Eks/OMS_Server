import { Router } from 'express';
import { authenticate, authorize } from '../Middleware/authMiddleware.ts';
import { initiateOnboarding, getCustomerOnboarding, completeOnboardingStep, getTrialCustomers } from '../Controllers/onboarding.controller.ts';

const router = Router();

router.use(authenticate);

router.post('/initiate', authorize(['onboarding:initiate']), initiateOnboarding);
router.get('/customers/:customerId', authorize(['onboarding:manage']), getCustomerOnboarding);
router.put('/:onboardingId/step/:stepId/complete', authorize(['onboarding:manage']), completeOnboardingStep);
router.get('/trial-customers', authorize(['onboarding:view_trials']), getTrialCustomers);

export default router;
