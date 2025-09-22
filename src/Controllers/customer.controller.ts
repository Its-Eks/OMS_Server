import type { Request, Response } from 'express';
import { CustomerService } from '../services/customer-fixed.service.ts';
import { Pool } from 'pg';
import { Redis } from 'ioredis';

// Define interfaces locally to avoid import issues
interface CreateCustomerData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
  customerType?: 'individual' | 'business';
  businessName?: string;
  businessRegistration?: string;
  isTrial?: boolean;
  trialEndDate?: Date;
}

interface UpdateCustomerData {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  address?: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
  customerType?: 'individual' | 'business';
  businessName?: string;
  businessRegistration?: string;
  isActive?: boolean;
  isTrial?: boolean;
  trialEndDate?: Date;
}

export class CustomerController {
  private customerService: CustomerService;

  constructor(customerService: CustomerService) {
    this.customerService = customerService;
  }

  /**
   * Create a new customer
   * POST /api/customers
   */
  async createCustomer(req: Request, res: Response): Promise<void> {
    try {
      const customerData: CreateCustomerData = req.body;
      const customer = await this.customerService.createCustomer(customerData);
      
      res.status(201).json({
        success: true,
        data: customer,
        message: 'Customer created successfully'
      });
    } catch (error: any) {
      console.error('Error creating customer:', error);
      res.status(400).json({
        success: false,
        error: {
          message: error.message,
          code: 'CUSTOMER_CREATION_FAILED'
        }
      });
    }
  }

  /**
   * Get customer by ID
   * GET /api/customers/:id
   */
  async getCustomerById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const customer = await this.customerService.getCustomerById(id);
      
      if (!customer) {
        res.status(404).json({
          success: false,
          error: {
            message: 'Customer not found',
            code: 'CUSTOMER_NOT_FOUND'
          }
        });
        return;
      }

      res.json({
        success: true,
        data: customer
      });
    } catch (error: any) {
      console.error('Error getting customer:', error);
      res.status(500).json({
        success: false,
        error: {
          message: error.message,
          code: 'CUSTOMER_FETCH_FAILED'
        }
      });
    }
  }

  /**
   * Get customer by email
   * GET /api/customers/email/:email
   */
  async getCustomerByEmail(req: Request, res: Response): Promise<void> {
    try {
      const { email } = req.params;
      const customer = await this.customerService.getCustomerByEmail(email);
      
      if (!customer) {
        res.status(404).json({
          success: false,
          error: {
            message: 'Customer not found',
            code: 'CUSTOMER_NOT_FOUND'
          }
        });
        return;
      }

      res.json({
        success: true,
        data: customer
      });
    } catch (error: any) {
      console.error('Error getting customer by email:', error);
      res.status(500).json({
        success: false,
        error: {
          message: error.message,
          code: 'CUSTOMER_FETCH_FAILED'
        }
      });
    }
  }

  /**
   * Get all customers with pagination and filters
   * GET /api/customers
   */
  async getCustomers(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const filters = {
        customerType: req.query.customerType as string,
        isTrial: req.query.isTrial ? req.query.isTrial === 'true' : undefined,
        isActive: req.query.isActive ? req.query.isActive === 'true' : undefined,
        search: req.query.search as string
      };

      const result = await this.customerService.getCustomers(page, limit, filters);
      
      res.json({
        success: true,
        data: result.customers,
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / result.limit)
        }
      });
    } catch (error: any) {
      console.error('Error getting customers:', error);
      res.status(500).json({
        success: false,
        error: {
          message: error.message,
          code: 'CUSTOMERS_FETCH_FAILED'
        }
      });
    }
  }

  /**
   * Update customer
   * PUT /api/customers/:id
   */
  async updateCustomer(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const updateData: UpdateCustomerData = req.body;
      
      const customer = await this.customerService.updateCustomer(id, updateData);
      
      res.json({
        success: true,
        data: customer,
        message: 'Customer updated successfully'
      });
    } catch (error: any) {
      console.error('Error updating customer:', error);
      res.status(400).json({
        success: false,
        error: {
          message: error.message,
          code: 'CUSTOMER_UPDATE_FAILED'
        }
      });
    }
  }

  /**
   * Delete customer (soft delete)
   * DELETE /api/customers/:id
   */
  async deleteCustomer(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const deleted = await this.customerService.deleteCustomer(id);
      
      if (!deleted) {
        res.status(404).json({
          success: false,
          error: {
            message: 'Customer not found',
            code: 'CUSTOMER_NOT_FOUND'
          }
        });
        return;
      }

      res.json({
        success: true,
        message: 'Customer deleted successfully'
      });
    } catch (error: any) {
      console.error('Error deleting customer:', error);
      res.status(500).json({
        success: false,
        error: {
          message: error.message,
          code: 'CUSTOMER_DELETE_FAILED'
        }
      });
    }
  }

  /**
   * Get trial customers
   * GET /api/customers/trial
   */
  async getTrialCustomers(req: Request, res: Response): Promise<void> {
    try {
      const customers = await this.customerService.getTrialCustomers();
      
      res.json({
        success: true,
        data: customers
      });
    } catch (error: any) {
      console.error('Error getting trial customers:', error);
      res.status(500).json({
        success: false,
        error: {
          message: error.message,
          code: 'TRIAL_CUSTOMERS_FETCH_FAILED'
        }
      });
    }
  }

  /**
   * Convert trial customer to regular customer
   * POST /api/customers/:id/convert-trial
   */
  async convertTrialToCustomer(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const customer = await this.customerService.convertTrialToCustomer(id);
      
      res.json({
        success: true,
        data: customer,
        message: 'Trial customer converted successfully'
      });
    } catch (error: any) {
      console.error('Error converting trial customer:', error);
      res.status(400).json({
        success: false,
        error: {
          message: error.message,
          code: 'TRIAL_CONVERSION_FAILED'
        }
      });
    }
  }

  /**
   * Get customer statistics
   * GET /api/customers/stats
   */
  async getCustomerStats(req: Request, res: Response): Promise<void> {
    try {
      const db: Pool = req.app.get('pgPool');
      
      // Get total customers
      const totalResult = await db.query('SELECT COUNT(*) FROM customers WHERE is_active = true');
      const total = parseInt(totalResult.rows[0].count);
      
      // Get trial customers
      const trialResult = await db.query('SELECT COUNT(*) FROM customers WHERE is_trial = true AND is_active = true');
      const trial = parseInt(trialResult.rows[0].count);
      
      // Get customers by type
      const individualResult = await db.query('SELECT COUNT(*) FROM customers WHERE customer_type = $1 AND is_active = true', ['individual']);
      const individual = parseInt(individualResult.rows[0].count);
      
      const businessResult = await db.query('SELECT COUNT(*) FROM customers WHERE customer_type = $1 AND is_active = true', ['business']);
      const business = parseInt(businessResult.rows[0].count);
      
      // Get recent customers (last 30 days)
      const recentResult = await db.query(
        'SELECT COUNT(*) FROM customers WHERE created_at >= NOW() - INTERVAL \'30 days\' AND is_active = true'
      );
      const recent = parseInt(recentResult.rows[0].count);
      
      res.json({
        success: true,
        data: {
          total,
          trial,
          individual,
          business,
          recent
        }
      });
    } catch (error: any) {
      console.error('Error getting customer stats:', error);
      res.status(500).json({
        success: false,
        error: {
          message: error.message,
          code: 'CUSTOMER_STATS_FAILED'
        }
      });
    }
  }
}
