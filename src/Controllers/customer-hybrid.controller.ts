import type { Request, Response } from 'express';
import { CustomerHybridService } from '../services/customer-hybrid.service.ts';
import type { CreateCustomerData, UpdateCustomerData } from '../services/customer-hybrid.service.ts';

function normalizeCreatePayload(body: any): CreateCustomerData {
  const address = body.address || {};
  return {
    first_name: body.first_name ?? body.firstName,
    last_name: body.last_name ?? body.lastName,
    email: body.email,
    phone: body.phone,
    address: {
      street: address.street,
      city: address.city,
      state: address.state,
      postal_code: address.postal_code ?? address.postalCode ?? address.zipCode,
      country: address.country,
    },
    customer_type: body.customer_type ?? body.customerType,
    is_trial: body.is_trial ?? body.isTrial,
    trial_start_date: body.trial_start_date ?? body.trialStartDate,
    trial_end_date: body.trial_end_date ?? body.trialEndDate,
  } as CreateCustomerData;
}

function normalizeUpdatePayload(body: any): UpdateCustomerData {
  const address = body.address;
  const normalized: UpdateCustomerData = {};

  if (body.first_name !== undefined || body.firstName !== undefined) normalized.first_name = body.first_name ?? body.firstName;
  if (body.last_name !== undefined || body.lastName !== undefined) normalized.last_name = body.last_name ?? body.lastName;
  if (body.email !== undefined) normalized.email = body.email;
  if (body.phone !== undefined) normalized.phone = body.phone;
  if (address !== undefined) {
    normalized.address = {
      street: address.street,
      city: address.city,
      state: address.state,
      postal_code: address.postal_code ?? address.postalCode ?? address.zipCode,
      country: address.country,
    } as any;
  }
  if (body.customer_type !== undefined || body.customerType !== undefined) normalized.customer_type = body.customer_type ?? body.customerType;
  if (body.is_trial !== undefined || body.isTrial !== undefined) normalized.is_trial = body.is_trial ?? body.isTrial;
  if (body.trial_start_date !== undefined || body.trialStartDate !== undefined) normalized.trial_start_date = body.trial_start_date ?? body.trialStartDate;
  if (body.trial_end_date !== undefined || body.trialEndDate !== undefined) normalized.trial_end_date = body.trial_end_date ?? body.trialEndDate;

  return normalized;
}

export class CustomerHybridController {
  private customerService: CustomerHybridService;

  constructor(customerService: CustomerHybridService) {
    this.customerService = customerService;
  }

  // Get all customers
  async getAllCustomers(req: Request, res: Response): Promise<void> {
    try {
      const customers = await this.customerService.getAllCustomers();
      res.json({
        success: true,
        data: customers,
        count: customers.length
      });
    } catch (error: any) {
      console.error('Error in getAllCustomers:', error);
      res.status(500).json({
        success: false,
        error: {
          message: error.message || 'Failed to fetch customers'
        }
      });
    }
  }

  // Get customer by ID
  async getCustomerById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      
      if (!id) {
        res.status(400).json({
          success: false,
          error: { message: 'Customer ID is required' }
        });
        return;
      }

      const customer = await this.customerService.getCustomerById(id);
      
      if (!customer) {
        res.status(404).json({
          success: false,
          error: { message: 'Customer not found' }
        });
        return;
      }

      res.json({
        success: true,
        data: customer
      });
    } catch (error: any) {
      console.error('Error in getCustomerById:', error);
      res.status(500).json({
        success: false,
        error: {
          message: error.message || 'Failed to fetch customer'
        }
      });
    }
  }

  // Get customer by Email
  async getCustomerByEmail(req: Request, res: Response): Promise<void> {
    try {
      const { email } = req.params as any;
      if (!email) {
        res.status(400).json({ success: false, error: { message: 'Email is required' } });
        return;
      }
      const customer = await this.customerService.getCustomerByEmail(email);
      if (!customer) {
        res.status(404).json({ success: false, error: { message: 'Customer not found' } });
        return;
      }
      res.json({ success: true, data: customer });
    } catch (error: any) {
      res.status(500).json({ success: false, error: { message: error.message || 'Failed to fetch customer by email' } });
    }
  }

  // Create customer (proxied to onboarding service)
  async createCustomer(req: Request, res: Response): Promise<void> {
    try {
      const customerData: CreateCustomerData = normalizeCreatePayload(req.body);

      // Validate required fields
      const requiredFields = ['first_name', 'last_name', 'email', 'phone', 'address'] as const;
      const missingFields = requiredFields.filter(field => !(customerData as any)[field]);
      
      if (missingFields.length > 0) {
        res.status(400).json({
          success: false,
          error: {
            message: `Missing required fields: ${missingFields.join(', ')}`
          }
        });
        return;
      }

      // Validate and normalize address structure
      if (customerData.address) {
        // Normalize address fields - handle both 'state' and 'province'
        if (customerData.address.province && !customerData.address.state) {
          customerData.address.state = customerData.address.province;
        }
        
        // Set default country if not provided
        if (!customerData.address.country) {
          customerData.address.country = 'South Africa';
        }
        
        const addressFields = ['street', 'city', 'state', 'postal_code', 'country'] as const;
        const missingAddressFields = addressFields.filter(field => !(customerData.address as any)[field]);
        
        if (missingAddressFields.length > 0) {
          res.status(400).json({
            success: false,
            error: {
              message: `Missing required address fields: ${missingAddressFields.join(', ')}`
            }
          });
          return;
        }
      }

      const customer = await this.customerService.createCustomer(customerData);
      
      res.status(201).json({
        success: true,
        data: customer,
        message: 'Customer created successfully'
      });
    } catch (error: any) {
      console.error('Error in createCustomer:', error);
      
      // Handle specific error types
      if (error.message.includes('Onboarding service is not available')) {
        res.status(503).json({
          success: false,
          error: {
            message: 'Customer creation service is temporarily unavailable. Please try again later.',
            code: 'SERVICE_UNAVAILABLE'
          }
        });
      } else if (error.message.includes('Invalid customer data')) {
        res.status(400).json({
          success: false,
          error: {
            message: error.message,
            code: 'INVALID_DATA'
          }
        });
      } else {
        res.status(500).json({
          success: false,
          error: {
            message: error.message || 'Failed to create customer'
          }
        });
      }
    }
  }

  // Update customer
  async updateCustomer(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const updateData: UpdateCustomerData = normalizeUpdatePayload(req.body);

      if (!id) {
        res.status(400).json({
          success: false,
          error: { message: 'Customer ID is required' }
        });
        return;
      }

      if (Object.keys(updateData).length === 0) {
        res.status(400).json({
          success: false,
          error: { message: 'No fields to update' }
        });
        return;
      }

      const customer = await this.customerService.updateCustomer(id, updateData);
      
      res.json({
        success: true,
        data: customer,
        message: 'Customer updated successfully'
      });
    } catch (error: any) {
      console.error('Error in updateCustomer:', error);
      
      if (error.message.includes('Customer not found')) {
        res.status(404).json({
          success: false,
          error: { message: 'Customer not found' }
        });
      } else {
        res.status(500).json({
          success: false,
          error: {
            message: error.message || 'Failed to update customer'
          }
        });
      }
    }
  }

  // Delete customer
  async deleteCustomer(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      if (!id) {
        res.status(400).json({
          success: false,
          error: { message: 'Customer ID is required' }
        });
        return;
      }

      const deleted = await this.customerService.deleteCustomer(id);
      
      if (!deleted) {
        res.status(404).json({
          success: false,
          error: { message: 'Customer not found' }
        });
        return;
      }

      res.json({
        success: true,
        message: 'Customer deleted successfully'
      });
    } catch (error: any) {
      console.error('Error in deleteCustomer:', error);
      res.status(500).json({
        success: false,
        error: {
          message: error.message || 'Failed to delete customer'
        }
      });
    }
  }

  // Get customer statistics
  async getCustomerStats(req: Request, res: Response): Promise<void> {
    try {
      const stats = await this.customerService.getCustomerStats();
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error: any) {
      console.error('Error in getCustomerStats:', error);
      res.status(500).json({
        success: false,
        error: {
          message: error.message || 'Failed to fetch customer statistics'
        }
      });
    }
  }

  // Check service health
  async checkServiceHealth(req: Request, res: Response): Promise<void> {
    try {
      const onboardingServiceHealthy = await this.customerService.checkOnboardingServiceHealth();
      
      res.json({
        success: true,
        data: {
          main_service: true,
          onboarding_service: onboardingServiceHealthy,
          hybrid_mode: true
        }
      });
    } catch (error: any) {
      console.error('Error in checkServiceHealth:', error);
      res.status(500).json({
        success: false,
        error: {
          message: error.message || 'Failed to check service health'
        }
      });
    }
  }

  // Get trial customers
  async getTrialCustomers(req: Request, res: Response): Promise<void> {
    try {
      const customers = await this.customerService.getTrialCustomers();
      res.json({ success: true, data: customers, count: customers.length });
    } catch (error: any) {
      res.status(500).json({ success: false, error: { message: error.message || 'Failed to fetch trial customers' } });
    }
  }

  // Convert trial to regular customer
  async convertTrialCustomer(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      if (!id) {
        res.status(400).json({ success: false, error: { message: 'Customer ID is required' } });
        return;
      }
      const updated = await this.customerService.convertTrialCustomer(id);
      res.json({ success: true, data: updated, message: 'Customer converted from trial' });
    } catch (error: any) {
      if (error.message.includes('not found')) {
        res.status(404).json({ success: false, error: { message: 'Customer not found' } });
        return;
      }
      res.status(500).json({ success: false, error: { message: error.message || 'Failed to convert trial customer' } });
    }
  }
}
