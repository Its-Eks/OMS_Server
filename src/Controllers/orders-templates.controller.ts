import type { Request, Response } from 'express';
import { OrdersTemplatesService, type OrderType, type TemplateData } from '../services/orders-templates.service.ts';

export class OrdersTemplatesController {
  private getService(req: Request): OrdersTemplatesService {
    return new OrdersTemplatesService(req.app.get('mongoClient'));
  }

  async getTemplates(req: Request, res: Response) {
    try {
      const { orderType, triggerStatus, isActive } = req.query;
      
      const filters: any = {};
      if (orderType) filters.orderType = orderType as OrderType;
      if (triggerStatus) filters.triggerStatus = String(triggerStatus);
      if (isActive !== undefined) filters.isActive = String(isActive).toLowerCase() === 'true';

      const service = this.getService(req);
      const templates = await service.getTemplates(filters);
      
      res.json({ 
        success: true, 
        data: templates,
        count: templates.length 
      });
    } catch (error: any) {
      console.error('[orders-templates] Error getting templates:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message || 'Failed to retrieve templates' 
      });
    }
  }

  async getTemplate(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const service = this.getService(req);
      const template = await service.getTemplate(id);
      
      if (!template) {
        return res.status(404).json({ 
          success: false, 
          error: 'Template not found' 
        });
      }
      
      res.json({ 
        success: true, 
        data: template 
      });
    } catch (error: any) {
      console.error('[orders-templates] Error getting template:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message || 'Failed to retrieve template' 
      });
    }
  }

  async createTemplate(req: Request, res: Response) {
    try {
      const { key, orderType, triggerStatus, subject, html, text, isActive = true } = req.body;
      
      // Validate required fields
      if (!key || !orderType || !triggerStatus || !subject || !html || !text) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: key, orderType, triggerStatus, subject, html, text'
        });
      }

      // Validate orderType
      if (!['new_installation', 'service_change', 'disconnect'].includes(orderType)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid orderType. Must be: new_installation, service_change, or disconnect'
        });
      }

      const service = this.getService(req);
      
      // Check if template with same key already exists
      const existing = await service.getTemplateByKey(key);
      if (existing) {
        return res.status(409).json({
          success: false,
          error: `Template with key '${key}' already exists`
        });
      }

      const result = await service.createTemplate({
        key,
        orderType,
        triggerStatus,
        subject,
        html,
        text,
        isActive
      });
      
      res.status(201).json({ 
        success: true, 
        data: { id: result.id },
        message: 'Template created successfully'
      });
    } catch (error: any) {
      console.error('[orders-templates] Error creating template:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message || 'Failed to create template' 
      });
    }
  }

  async updateTemplate(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const updates = req.body;
      
      // Remove fields that shouldn't be updated directly
      delete updates._id;
      delete updates.createdAt;
      delete updates.updatedAt;

      // Validate orderType if provided
      if (updates.orderType && !['new_installation', 'service_change', 'disconnect'].includes(updates.orderType)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid orderType. Must be: new_installation, service_change, or disconnect'
        });
      }

      const service = this.getService(req);
      
      // Check if template exists
      const existing = await service.getTemplate(id);
      if (!existing) {
        return res.status(404).json({
          success: false,
          error: 'Template not found'
        });
      }

      // If updating key, check for conflicts
      if (updates.key && updates.key !== existing.key) {
        const keyExists = await service.getTemplateByKey(updates.key);
        if (keyExists) {
          return res.status(409).json({
            success: false,
            error: `Template with key '${updates.key}' already exists`
          });
        }
      }

      const success = await service.updateTemplate(id, updates);
      
      if (!success) {
        return res.status(404).json({
          success: false,
          error: 'Template not found or no changes made'
        });
      }
      
      res.json({ 
        success: true, 
        message: 'Template updated successfully' 
      });
    } catch (error: any) {
      console.error('[orders-templates] Error updating template:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message || 'Failed to update template' 
      });
    }
  }

  async deleteTemplate(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const service = this.getService(req);
      
      const success = await service.deleteTemplate(id);
      
      if (!success) {
        return res.status(404).json({
          success: false,
          error: 'Template not found'
        });
      }
      
      res.json({ 
        success: true, 
        message: 'Template deleted successfully' 
      });
    } catch (error: any) {
      console.error('[orders-templates] Error deleting template:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message || 'Failed to delete template' 
      });
    }
  }

  async seedDefaults(req: Request, res: Response) {
    try {
      const service = this.getService(req);
      const result = await service.seedDefaultTemplates();
      
      res.json({ 
        success: true, 
        data: result,
        message: `Seeding complete: ${result.created} templates created, ${result.skipped} skipped`
      });
    } catch (error: any) {
      console.error('[orders-templates] Error seeding defaults:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message || 'Failed to seed default templates' 
      });
    }
  }

  async triggerEmail(req: Request, res: Response) {
    try {
      const { 
        orderId, 
        orderType, 
        status, 
        customerEmail, 
        templateData = {} 
      } = req.body;
      
      // Validate required fields
      if (!orderId || !orderType || !status || !customerEmail) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: orderId, orderType, status, customerEmail'
        });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(customerEmail)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid email format'
        });
      }

      // Validate orderType
      if (!['new_installation', 'service_change', 'disconnect'].includes(orderType)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid orderType. Must be: new_installation, service_change, or disconnect'
        });
      }

      const service = this.getService(req);
      
      // Add orderId to template data if not provided
      const enrichedTemplateData: TemplateData = {
        orderId,
        ...templateData
      };

      const result = await service.sendOrderEmail(
        orderType as OrderType,
        status,
        customerEmail,
        enrichedTemplateData
      );
      
      if (result.success) {
        res.json({ 
          success: true, 
          data: { 
            templateUsed: result.templateUsed,
            orderId,
            customerEmail,
            status 
          },
          message: 'Email sent successfully' 
        });
      } else {
        res.status(400).json({ 
          success: false, 
          error: result.error || 'Failed to send email' 
        });
      }
    } catch (error: any) {
      console.error('[orders-templates] Error triggering email:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message || 'Failed to trigger email' 
      });
    }
  }

  async previewTemplate(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const templateData = req.query as Record<string, string>;
      
      // Convert query parameters to template data
      const data: TemplateData = {};
      Object.entries(templateData).forEach(([key, value]) => {
        data[key] = String(value);
      });

      // Add some default sample data if not provided
      const sampleData: TemplateData = {
        customerName: 'John Doe',
        orderNumber: 'ORD-SAMPLE-123',
        serviceType: 'Fiber 100Mbps',
        address: '123 Main Street, City, State 12345',
        contactNumber: '+1 (555) 123-4567',
        installationDate: '2025-10-15',
        appointmentTime: '09:00 AM - 12:00 PM',
        technicianName: 'Mike Johnson',
        estimatedDuration: '2-3 hours',
        supportNumber: '+1 (555) 987-6543',
        ...data // Override with provided data
      };

      const service = this.getService(req);
      const preview = await service.previewTemplate(id, sampleData);
      
      if (!preview) {
        return res.status(404).json({
          success: false,
          error: 'Template not found'
        });
      }
      
      res.json({ 
        success: true, 
        data: {
          preview,
          sampleData: sampleData
        }
      });
    } catch (error: any) {
      console.error('[orders-templates] Error previewing template:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message || 'Failed to preview template' 
      });
    }
  }

  // Helper method to trigger emails from order status changes
  async triggerOrderStatusEmail(
    orderId: string,
    orderType: OrderType,
    newStatus: string,
    customerEmail: string,
    orderData: any
  ): Promise<{ success: boolean; error?: string; templateUsed?: string }> {
    try {
      const service = new OrdersTemplatesService();
      
      // Build template data from order information
      const templateData: TemplateData = {
        orderId,
        orderNumber: orderData.order_number || orderId,
        customerName: orderData.customer_name || 'Valued Customer',
        customerEmail,
        serviceType: orderData.service_type || 'Internet Service',
        address: orderData.address || orderData.installation_address || '',
        contactNumber: orderData.contact_number || process.env.SUPPORT_PHONE || '+1 (555) 123-4567',
        installationDate: orderData.installation_date || orderData.scheduled_date || '',
        appointmentTime: orderData.appointment_time || '',
        technicianName: orderData.technician_name || '',
        estimatedDuration: orderData.estimated_duration || '2-3 hours',
        supportNumber: process.env.SUPPORT_PHONE || '+1 (555) 987-6543',
        billingNumber: process.env.BILLING_PHONE || '+1 (555) 456-7890',
        customerPortalUrl: process.env.CUSTOMER_PORTAL_URL || 'https://portal.example.com',
        mobileAppName: process.env.MOBILE_APP_NAME || 'MyISP App',
        
        // Service change specific data
        currentService: orderData.current_service || '',
        previousService: orderData.previous_service || '',
        changeType: orderData.change_type || 'Service Upgrade',
        changeDate: orderData.change_date || orderData.scheduled_date || '',
        changeTime: orderData.change_time || orderData.appointment_time || '',
        expectedDowntime: orderData.expected_downtime || '15-30 minutes',
        
        // Installation specific data
        surveyDate: orderData.survey_date || '',
        surveyTime: orderData.survey_time || '',
        technicianPhone: orderData.technician_phone || '',
        activationDate: orderData.activation_date || new Date().toLocaleDateString(),
        wifiNetwork: orderData.wifi_network || orderData.network_name || '',
        
        // Performance data
        downloadSpeed: orderData.download_speed || '',
        uploadSpeed: orderData.upload_speed || '',
        latency: orderData.latency || '',
        testTime: orderData.test_time || new Date().toLocaleString(),
        
        // Completion data
        completionDate: orderData.completion_date || new Date().toLocaleDateString(),
        newFeature1: orderData.new_feature_1 || 'Enhanced speed and reliability',
        newFeature2: orderData.new_feature_2 || 'Improved customer support',
        newFeature3: orderData.new_feature_3 || 'Advanced security features'
      };

      return await service.sendOrderEmail(orderType, newStatus, customerEmail, templateData);
    } catch (error: any) {
      console.error('[orders-templates] Error in triggerOrderStatusEmail:', error);
      return { 
        success: false, 
        error: error.message || 'Failed to send order status email' 
      };
    }
  }
}
