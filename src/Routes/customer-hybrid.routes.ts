import express from 'express';
import { authenticate, authorize } from '../Middleware/authMiddleware.ts';
import { pgPool } from '../Database/main.ts';
import { CustomerHybridService } from '../services/customer-hybrid.service.ts';
import { CustomerHybridController } from '../Controllers/customer-hybrid.controller.ts';

const router = express.Router();

// Initialize services
const customerService = new CustomerHybridService(pgPool);
const customerController = new CustomerHybridController(customerService);

// Customer routes with full hybrid functionality

// Get all customers (handled by main server)
router.get('/', authenticate, authorize(['customers:read']), 
  (req, res) => customerController.getAllCustomers(req, res)
);

// Get trial customers (handled by main server with onboarding fallback)
router.get('/trial', authenticate, authorize(['customers:read']), 
  (req, res) => customerController.getTrialCustomers(req, res)
);

// Get customer statistics (handled by main server)
router.get('/stats', authenticate, authorize(['customers:read']), 
  (req, res) => customerController.getCustomerStats(req, res)
);

// Check service health
router.get('/health/services', authenticate, authorize(['customers:read']), 
  (req, res) => customerController.checkServiceHealth(req, res)
);

// Create customer (proxied to onboarding service)
router.post('/', authenticate, authorize(['customers:create']), 
  (req, res) => customerController.createCustomer(req, res)
);

// Update customer (handled by main server)
router.put('/:id', authenticate, authorize(['customers:update']), 
  (req, res) => customerController.updateCustomer(req, res)
);

// Delete customer (handled by main server)
router.delete('/:id', authenticate, authorize(['customers:delete']), 
  (req, res) => customerController.deleteCustomer(req, res)
);

// Convert trial customer to regular customer
router.post('/:id/convert-trial', authenticate, authorize(['customers:update']), 
  (req, res) => customerController.convertTrialCustomer(req, res)
);

// Get customer by email (ensure URL-encoded email)
router.get('/email/:email', authenticate, authorize(['customers:read']), 
  (req, res) => customerController.getCustomerByEmail(req, res)
);

// Get customer by ID (handled by main server)
router.get('/:id', authenticate, authorize(['customers:read']), 
  (req, res) => customerController.getCustomerById(req, res)
);

export default router;
