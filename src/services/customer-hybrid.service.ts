import { Pool } from 'pg';
import axios from 'axios';

// Local interfaces to avoid import issues
export interface Customer {
  id: string;
  customer_number: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address: Address;
  customer_type: 'individual' | 'business';
  is_trial: boolean;
  trial_start_date?: string | null;
  trial_end_date?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Address {
  street: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
}

export interface CreateCustomerData {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address: Address;
  customer_type?: 'individual' | 'business';
  is_trial?: boolean;
  trial_start_date?: string | null;
  trial_end_date?: string | null;
}

export interface UpdateCustomerData {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  address?: Address;
  customer_type?: 'individual' | 'business';
  is_trial?: boolean;
  trial_start_date?: string | null;
  trial_end_date?: string | null;
}

export class CustomerHybridService {
  private pgPool: Pool;
  private onboardingServiceUrl: string;

  constructor(pgPool: Pool) {
    this.pgPool = pgPool;
    const raw = process.env.ONBOARDING_SERVICE_URL || 'https://microservices-oms.onrender.com';
    this.onboardingServiceUrl = raw.replace(/\/+$/g, '');
  }

  private buildUrl(path: string): string {
    const cleanPath = (path || '').replace(/^\/+/, '/');
    return `${this.onboardingServiceUrl}${cleanPath.startsWith('/') ? '' : '/'}${cleanPath}`;
  }

  // Get all customers (handled by main server)
  async getAllCustomers(): Promise<Customer[]> {
    try {
      const result = await this.pgPool.query(`
        SELECT 
          id, customer_number, first_name, last_name, email, phone, 
          address, customer_type, is_trial, trial_start_date, trial_end_date,
          created_at, updated_at
        FROM customers 
        ORDER BY created_at DESC
      `);
      
      return result.rows.map(this.mapRowToCustomer);
    } catch (error) {
      console.error('Error fetching customers:', error);
      throw new Error('Failed to fetch customers');
    }
  }

  // Get trial customers (DB first, then onboarding fallback)
  async getTrialCustomers(): Promise<Customer[]> {
    try {
      const result = await this.pgPool.query(`
        SELECT 
          id, customer_number, first_name, last_name, email, phone, 
          address, customer_type, is_trial, trial_start_date, trial_end_date,
          created_at, updated_at
        FROM customers 
        WHERE is_trial = true
        ORDER BY created_at DESC
      `);
      if (result.rows.length > 0) {
        return result.rows.map(this.mapRowToCustomer);
      }
    } catch (err) {
      console.warn('DB trial list failed, will try onboarding fallback:', (err as Error).message);
    }

    // Fallback to onboarding service
    try {
      // Prefer dedicated trial endpoint; fallback to full list and filter if needed
      const urls = [
        `${this.onboardingServiceUrl}/api/onboarding/trial-customers`,
        `${this.onboardingServiceUrl}/api/onboarding/customers`
      ];
      for (const url of urls) {
        try {
          const resp = await axios.get(url, { timeout: 8000 });
          if (resp.status >= 200 && resp.status < 300) {
            const data = resp.data?.data ?? resp.data;
            const list = Array.isArray(data?.customers) ? data.customers : Array.isArray(data) ? data : [];
            // Map common shapes into Customer
            const mapped: Customer[] = list.map((item: any) => {
              const c = item.customer ? item.customer : item;
              return {
                id: c.id || item.id || `temp_${Math.random()}`,
                customer_number: c.customer_number || c.customerNumber || '',
                first_name: c.first_name || c.firstName,
                last_name: c.last_name || c.lastName,
                email: c.email,
                phone: c.phone || '',
                address: c.address || item.address || { street: '', city: '', state: '', postal_code: '', country: '' },
                customer_type: (c.customer_type || c.customerType || 'individual') as 'individual' | 'business',
                is_trial: true,
                trial_start_date: c.trial_start_date || c.trialStartDate || null,
                trial_end_date: c.trial_end_date || c.trialEndDate || null,
                created_at: c.created_at || new Date().toISOString(),
                updated_at: c.updated_at || new Date().toISOString(),
              };
            });
            return mapped;
          }
        } catch (e) {
          // try next url
          continue;
        }
      }
    } catch {}

    return [];
  }

  // Get customer by ID (handled by main server)
  async getCustomerById(id: string): Promise<Customer | null> {
    try {
      const result = await this.pgPool.query(`
        SELECT 
          id, customer_number, first_name, last_name, email, phone, 
          address, customer_type, is_trial, trial_start_date, trial_end_date,
          created_at, updated_at
        FROM customers 
        WHERE id = $1
      `, [id]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      return this.mapRowToCustomer(result.rows[0]);
    } catch (error) {
      console.error('Error fetching customer:', error);
      throw new Error('Failed to fetch customer');
    }
  }

  // Get customer by Email (DB first, then onboarding fallback)
  async getCustomerByEmail(email: string): Promise<Customer | null> {
    try {
      const result = await this.pgPool.query(
        `SELECT 
           id, customer_number, first_name, last_name, email, phone,
           address, customer_type, is_trial, trial_start_date, trial_end_date,
           created_at, updated_at
         FROM customers WHERE LOWER(email) = LOWER($1) LIMIT 1`,
        [email]
      );
      if (result.rows.length > 0) {
        return this.mapRowToCustomer(result.rows[0]);
      }
    } catch (err) {
      console.warn('DB email lookup failed, trying onboarding fallback:', (err as Error).message);
    }

    // Fallback to onboarding list and filter
    try {
      const url = `${this.onboardingServiceUrl}/api/onboarding/customers`;
      const resp = await axios.get(url, { timeout: 8000 });
      if (resp.status >= 200 && resp.status < 300) {
        const data = resp.data?.data ?? resp.data;
        const list: any[] = Array.isArray(data) ? data : Array.isArray(data?.customers) ? data.customers : [];
        const found = list.find((c: any) => (c.email ?? c.customer?.email)?.toLowerCase() === email.toLowerCase());
        if (found) {
          const c = found.customer ? found.customer : found;
          return {
            id: c.id || `temp_${Math.random()}`,
            customer_number: c.customer_number || c.customerNumber || '',
            first_name: c.first_name || c.firstName,
            last_name: c.last_name || c.lastName,
            email: c.email,
            phone: c.phone || '',
            address: c.address || { street: '', city: '', state: '', postal_code: '', country: '' },
            customer_type: (c.customer_type || c.customerType || 'individual') as 'individual' | 'business',
            is_trial: Boolean(c.is_trial ?? c.isTrial),
            trial_start_date: c.trial_start_date || c.trialStartDate || null,
            trial_end_date: c.trial_end_date || c.trialEndDate || null,
            created_at: c.created_at || new Date().toISOString(),
            updated_at: c.updated_at || new Date().toISOString(),
          };
        }
      }
    } catch {}

    return null;
  }

  // Create customer (direct database creation with UUID)
  async createCustomer(customerData: CreateCustomerData): Promise<Customer> {
    try {
      // Generate a short customer number
      const customerNumber = `CUST-${Math.floor(Math.random() * 100000).toString().padStart(5, '0')}`;
      
      // Create customer directly in database with UUID
      const result = await this.pgPool.query(
        `INSERT INTO customers (
           id, customer_number, first_name, last_name, email, phone, address,
           customer_type, is_trial, trial_start_date, trial_end_date, created_at, updated_at
         ) VALUES (
           gen_random_uuid(), $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, NOW(), NOW()
         ) RETURNING 
           id, customer_number, first_name, last_name, email, phone, address,
           customer_type, is_trial, trial_start_date, trial_end_date, created_at, updated_at`,
        [
          customerNumber,
          customerData.first_name,
          customerData.last_name,
          customerData.email,
          customerData.phone,
          JSON.stringify(customerData.address),
          customerData.customer_type || 'individual',
          customerData.is_trial || false,
          customerData.trial_start_date || null,
          customerData.trial_end_date || null
        ]
      );

      if (result.rows.length === 0) {
        throw new Error('Failed to create customer');
      }

      return this.mapRowToCustomer(result.rows[0]);
    } catch (error: any) {
      console.error('Error creating customer directly:', error);
      
      // If database creation fails, fallback to onboarding service
      console.log('Falling back to onboarding service...');
      return await this.createCustomerViaOnboarding(customerData);
    }
  }

  // Fallback method to create customer via onboarding service
  private async createCustomerViaOnboarding(customerData: CreateCustomerData): Promise<Customer> {
    const customPath = process.env.ONBOARDING_CUSTOMER_CREATE_PATH;
    const candidates = [
      customPath || '/api/onboarding/customers'
    ];

    const headers = { 'Content-Type': 'application/json' } as Record<string, string>;

    let lastError: any = null;
    for (const path of candidates) {
      const url = this.buildUrl(path);
      try {
        const response = await axios.post(url, customerData, { headers, timeout: 15000 });
        if (response.status >= 200 && response.status < 300 && response.data?.success !== false) {
          return response.data.data ?? response.data;
        }
        lastError = new Error(response.data?.error?.message || `Unexpected response from ${url}`);
      } catch (error: any) {
        // Retry once on 502/503 (Render cold start / routing)
        const status = error?.response?.status;
        if (status === 502 || status === 503) {
          try {
            await new Promise(r => setTimeout(r, 800));
            const retryResp = await axios.post(url, customerData, { headers, timeout: 15000 });
            if (retryResp.status >= 200 && retryResp.status < 300 && retryResp.data?.success !== false) {
              return retryResp.data.data ?? retryResp.data;
            }
          } catch (retryErr: any) {
            lastError = retryErr;
          }
        } else if (status === 404) {
          lastError = new Error('Onboarding service endpoint not found');
          continue; // try next candidate
        } else {
          lastError = error;
          break; // non-retryable
        }
      }
    }

    console.error('Error creating customer via onboarding service:', lastError);

    if (lastError?.code === 'ECONNREFUSED') {
      throw new Error('Onboarding service is not available. Please try again later.');
    }
    if (lastError?.response?.status === 400) {
      throw new Error(lastError.response.data?.error?.message || 'Invalid customer data');
    }
    if (lastError?.response?.status === 500) {
      throw new Error('Onboarding service error. Please try again later.');
    }
    if (lastError?.message === 'Onboarding service endpoint not found') {
      throw lastError;
    }
    throw new Error('Failed to create customer');
  }

  // Update customer (handled by main server)
  async updateCustomer(id: string, updateData: UpdateCustomerData): Promise<Customer> {
    try {
      const fields = [] as string[];
      const values = [] as any[];
      let paramCount = 1;

      // Build dynamic update query
      Object.entries(updateData).forEach(([key, value]) => {
        if (value !== undefined) {
          fields.push(`${key} = $${paramCount}`);
          values.push(typeof value === 'object' ? JSON.stringify(value) : value);
          paramCount++;
        }
      });

      if (fields.length === 0) {
        throw new Error('No fields to update');
      }

      fields.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(id);

      const query = `
        UPDATE customers 
        SET ${fields.join(', ')}
        WHERE id = $${paramCount}
        RETURNING 
          id, customer_number, first_name, last_name, email, phone, 
          address, customer_type, is_trial, trial_start_date, trial_end_date,
          created_at, updated_at
      `;

      const result = await this.pgPool.query(query, values);
      
      if (result.rows.length === 0) {
        throw new Error('Customer not found');
      }

      return this.mapRowToCustomer(result.rows[0]);
    } catch (error) {
      console.error('Error updating customer:', error);
      throw new Error('Failed to update customer');
    }
  }

  // Delete customer (handled by main server)
  async deleteCustomer(id: string): Promise<boolean> {
    try {
      const result = await this.pgPool.query('DELETE FROM customers WHERE id = $1', [id]);
      return result.rowCount > 0;
    } catch (error) {
      console.error('Error deleting customer:', error);
      throw new Error('Failed to delete customer');
    }
  }

  // Get customer statistics (handled by main server) with onboarding fallback
  async getCustomerStats(): Promise<{
    total: number;
    trial: number;
    individual: number;
    business: number;
  }> {
    try {
      const result = await this.pgPool.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN is_trial = true THEN 1 END) as trial,
          COUNT(CASE WHEN customer_type = 'individual' THEN 1 END) as individual,
          COUNT(CASE WHEN customer_type = 'business' THEN 1 END) as business
        FROM customers
      `);
      const stats = result.rows[0] as any;
      const response = {
        total: parseInt(stats.total),
        trial: parseInt(stats.trial),
        individual: parseInt(stats.individual),
        business: parseInt(stats.business)
      };
      // If DB is reachable but empty, still consider falling back if onboarding has data
      if (response.total > 0) return response;
    } catch (error) {
      console.warn('DB stats failed, will try onboarding fallback:', (error as Error).message);
    }

    // Fallback to onboarding service listing to compute approximate stats
    try {
      const url = `${this.onboardingServiceUrl}/api/onboarding/customers`;
      const resp = await axios.get(url, { timeout: 8000 });
      if (resp.status >= 200 && resp.status < 300) {
        const data = resp.data?.data ?? resp.data;
        const list: any[] = Array.isArray(data) ? data : Array.isArray(data?.customers) ? data.customers : [];
        const total = list.length;
        const trial = list.filter((c: any) => (c.is_trial ?? c.isTrial) === true).length;
        const individual = list.filter((c: any) => (c.customer_type ?? c.customerType ?? 'individual') === 'individual').length;
        const business = list.filter((c: any) => (c.customer_type ?? c.customerType) === 'business').length;
        return { total, trial, individual, business };
      }
    } catch {}

    // Last resort
    return { total: 0, trial: 0, individual: 0, business: 0 };
  }

  // Convert trial to regular customer (handled by main server)
  async convertTrialCustomer(customerId: string): Promise<Customer> {
    try {
      const result = await this.pgPool.query(
        `UPDATE customers 
         SET is_trial = false, trial_end_date = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING 
           id, customer_number, first_name, last_name, email, phone, 
           address, customer_type, is_trial, trial_start_date, trial_end_date,
           created_at, updated_at`,
        [customerId]
      );

      if (result.rows.length === 0) {
        throw new Error('Customer not found');
      }

      return this.mapRowToCustomer(result.rows[0]);
    } catch (error) {
      console.error('Error converting trial customer:', error);
      throw new Error('Failed to convert trial customer');
    }
  }

  // Check if onboarding service is available
  async checkOnboardingServiceHealth(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.onboardingServiceUrl}/health`, {
        timeout: 5000
      });
      return response.status === 200;
    } catch (error) {
      console.error('Onboarding service health check failed:', error);
      return false;
    }
  }

  // Helper method to map database row to Customer object
  private mapRowToCustomer(row: any): Customer {
    return {
      id: row.id,
      customer_number: row.customer_number,
      first_name: row.first_name,
      last_name: row.last_name,
      email: row.email,
      phone: row.phone,
      address: typeof row.address === 'string' ? JSON.parse(row.address) : row.address,
      customer_type: row.customer_type,
      is_trial: row.is_trial,
      trial_start_date: row.trial_start_date ?? null,
      trial_end_date: row.trial_end_date ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }
}
