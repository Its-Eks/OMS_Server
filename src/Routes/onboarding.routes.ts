import { Router } from 'express';
import axios from 'axios';
import { authenticate, authorize } from '../Middleware/authMiddleware.ts';
import { initiateOnboarding, getCustomerOnboarding, completeOnboardingStep, getTrialCustomers } from '../Controllers/onboarding.controller.ts';

const router = Router();

router.use(authenticate);

router.post('/initiate', authorize(['onboarding:initiate']), initiateOnboarding);
router.get('/customers/:customerId', authorize(['onboarding:manage']), getCustomerOnboarding);
router.put('/:onboardingId/step/:stepId/complete', authorize(['onboarding:manage']), completeOnboardingStep);
router.get('/trial-customers', authorize(['onboarding:view_trials']), getTrialCustomers);

// Proxy to onboarding-service
const base = (process.env.ONBOARDING_SERVICE_URL || 'https://microservices-oms.onrender.com').replace(/\/+$/g, '');

router.get('/active', authorize(['onboarding:manage']), async (req, res) => {
  try {
    const resp = await axios.get(`${base}/api/onboarding/active`, { timeout: 10000 });
    res.status(resp.status).json(resp.data);
  } catch (e: any) {
    res.status(e?.response?.status || 500).json(e?.response?.data || { success: false, error: { message: 'Failed to fetch active onboardings' } });
  }
});

router.get('/:id', authorize(['onboarding:manage']), async (req, res) => {
  try {
    const resp = await axios.get(`${base}/api/onboarding/${req.params.id}`, { timeout: 10000 });
    res.status(resp.status).json(resp.data);
  } catch (e: any) {
    res.status(e?.response?.status || 500).json(e?.response?.data || { success: false, error: { message: 'Failed to fetch onboarding' } });
  }
});

router.patch('/:id/assign', authorize(['onboarding:manage']), async (req, res) => {
  try {
    const resp = await axios.patch(`${base}/api/onboarding/${req.params.id}/assign`, req.body, { timeout: 10000 });
    res.status(resp.status).json(resp.data);
  } catch (e: any) {
    res.status(e?.response?.status || 500).json(e?.response?.data || { success: false, error: { message: 'Failed to assign onboarding' } });
  }
});

router.post('/:id/notify', authorize(['onboarding:manage']), async (req, res) => {
  try {
    const resp = await axios.post(`${base}/api/onboarding/${req.params.id}/notify`, req.body, { timeout: 10000 });
    res.status(resp.status).json(resp.data);
  } catch (e: any) {
    res.status(e?.response?.status || 500).json(e?.response?.data || { success: false, error: { message: 'Failed to send notification' } });
  }
});

// Step/Progress management proxies
router.put('/:id/step/:stepId', authorize(['onboarding:manage']), async (req, res) => {
  try {
    const resp = await axios.put(`${base}/api/onboarding/${req.params.id}/step/${req.params.stepId}`, req.body, { timeout: 10000 });
    res.status(resp.status).json(resp.data);
  } catch (e: any) {
    res.status(e?.response?.status || 500).json(e?.response?.data || { success: false, error: { message: 'Failed to update onboarding step' } });
  }
});

router.get('/:id/steps', authorize(['onboarding:manage']), async (req, res) => {
  try {
    const resp = await axios.get(`${base}/api/onboarding/${req.params.id}/steps`, { timeout: 10000 });
    res.status(resp.status).json(resp.data);
  } catch (e: any) {
    res.status(e?.response?.status || 500).json(e?.response?.data || { success: false, error: { message: 'Failed to fetch onboarding steps' } });
  }
});

export default router;
