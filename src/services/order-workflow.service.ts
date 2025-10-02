import type { Pool } from 'pg';
import { triggerOrderStatusEmail, type OrderStatusChangeEvent } from './order-email-hooks.service.ts';

export interface WorkflowStep {
  status: string;
  templateKey: string;
  nextStatus?: string;
  autoAdvanceAfter?: number; // milliseconds to wait before auto-advancing
  requiresManualApproval?: boolean;
  manualApprovalTimeout?: number; // milliseconds to wait for manual approval before escalating
  fallbackAction?: 'auto_advance' | 'escalate' | 'hold' | 'cancel';
  reminderEmails?: {
    intervals: number[]; // Send reminders at these intervals (in milliseconds)
    recipients: 'customer' | 'technician' | 'operations' | 'all';
  };
  conditions?: {
    field: string;
    operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than';
    value: any;
  }[];
}

export interface OrderWorkflow {
  orderType: 'new_installation' | 'service_change' | 'disconnect';
  steps: WorkflowStep[];
}

/**
 * Service to manage sequential order workflows and automatic email progression
 */
export class OrderWorkflowService {
  private db: Pool;
  private mongoClient: any;

  // Define the workflows for each order type
  private workflows: Record<string, OrderWorkflow> = {
    'new_installation': {
      orderType: 'new_installation',
      steps: [
        {
          status: 'scheduled',
          templateKey: 'new_installation_scheduled',
          nextStatus: 'completed',
          requiresManualApproval: true, // Technician must complete installation
          manualApprovalTimeout: 7 * 24 * 60 * 60 * 1000, // 7 days max for installation
          fallbackAction: 'escalate', // Escalate if installation not completed
          reminderEmails: {
            intervals: [24 * 60 * 60 * 1000, 72 * 60 * 60 * 1000], // 1 day, 3 days
            recipients: 'technician'
          }
        },
        {
          status: 'completed',
          templateKey: 'new_installation_completed',
          // Final step - service is live
        }
      ]
    },
    'service_change': {
      orderType: 'service_change',
      steps: [
        {
          status: 'scheduled',
          templateKey: 'service_change_scheduled',
          nextStatus: 'completed',
          requiresManualApproval: true, // Technician must complete change
          manualApprovalTimeout: 3 * 24 * 60 * 60 * 1000, // 3 days max for service change
          fallbackAction: 'escalate',
          reminderEmails: {
            intervals: [24 * 60 * 60 * 1000], // 1 day reminder
            recipients: 'technician'
          }
        },
        {
          status: 'completed',
          templateKey: 'service_change_completed',
          // Final step - service change is live
        }
      ]
    }
  };

  constructor(db: Pool, mongoClient?: any) {
    this.db = db;
    this.mongoClient = mongoClient;
  }

  /**
   * Start a workflow for a new order
   */
  async startWorkflow(orderId: string, orderType: 'new_installation' | 'service_change'): Promise<{
    success: boolean;
    currentStep?: WorkflowStep;
    error?: string;
  }> {
    try {
      console.log(`[workflow] 🚀 Starting ${orderType} workflow for order ${orderId}`);

      const workflow = this.workflows[orderType];
      if (!workflow) {
        return { success: false, error: `No workflow defined for order type: ${orderType}` };
      }

      const firstStep = workflow.steps[0];
      if (!firstStep) {
        return { success: false, error: `No steps defined for workflow: ${orderType}` };
      }
      
      // Update order status to first step
      await this.updateOrderStatus(orderId, firstStep.status);
      
      // Send first email
      await this.sendStepEmail(orderId, firstStep);
      
      // Schedule auto-advancement if configured
      if (firstStep.autoAdvanceAfter && !firstStep.requiresManualApproval) {
        await this.scheduleAutoAdvancement(orderId, firstStep.autoAdvanceAfter);
      }

      // Schedule manual approval timeout and reminders if configured
      if (firstStep.requiresManualApproval) {
        await this.scheduleManualApprovalHandling(orderId, firstStep);
      }

      // Log workflow start
      await this.logWorkflowEvent(orderId, 'workflow_started', { orderType, step: firstStep.status });

      return { success: true, currentStep: firstStep };

    } catch (error: any) {
      console.error('[workflow] ❌ Error starting workflow:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Advance workflow to next step
   */
  async advanceWorkflow(orderId: string, currentStatus: string, manualAdvance: boolean = false): Promise<{
    success: boolean;
    nextStep?: WorkflowStep;
    completed?: boolean;
    error?: string;
  }> {
    try {
      console.log(`[workflow] ⏭️ Advancing workflow for order ${orderId} from ${currentStatus}`);

      // Get order details
      const order = await this.getOrderDetails(orderId);
      if (!order) {
        return { success: false, error: 'Order not found' };
      }

      const workflow = this.workflows[order.order_type];
      if (!workflow) {
        return { success: false, error: `No workflow for order type: ${order.order_type}` };
      }

      // Find current step
      const currentStepIndex = workflow.steps.findIndex(step => step.status === currentStatus);
      if (currentStepIndex === -1) {
        return { success: false, error: `Current status ${currentStatus} not found in workflow` };
      }

      const currentStep = workflow.steps[currentStepIndex];
      if (!currentStep) {
        return { success: false, error: `Current step not found at index ${currentStepIndex}` };
      }
      
      // Check if manual approval is required and this is not a manual advance
      if (currentStep.requiresManualApproval && !manualAdvance) {
        console.log(`[workflow] ⏸️ Step ${currentStatus} requires manual approval, skipping auto-advance`);
        return { success: true };
      }

      // Check if there's a next step
      const nextStepIndex = currentStepIndex + 1;
      if (nextStepIndex >= workflow.steps.length) {
        console.log(`[workflow] ✅ Workflow completed for order ${orderId}`);
        await this.logWorkflowEvent(orderId, 'workflow_completed', { finalStatus: currentStatus });
        return { success: true, completed: true };
      }

      const nextStep = workflow.steps[nextStepIndex];
      if (!nextStep) {
        return { success: false, error: `Next step not found at index ${nextStepIndex}` };
      }

      // Update order status
      await this.updateOrderStatus(orderId, nextStep.status);

      // Send email for next step
      await this.sendStepEmail(orderId, nextStep);

      // Schedule next auto-advancement if configured
      if (nextStep.autoAdvanceAfter && !nextStep.requiresManualApproval) {
        await this.scheduleAutoAdvancement(orderId, nextStep.autoAdvanceAfter);
      }

      // Schedule manual approval handling for next step if needed
      if (nextStep.requiresManualApproval) {
        await this.scheduleManualApprovalHandling(orderId, nextStep);
      }

      // Log advancement
      await this.logWorkflowEvent(orderId, 'workflow_advanced', { 
        fromStatus: currentStatus, 
        toStatus: nextStep.status,
        manualAdvance 
      });

      return { success: true, nextStep };

    } catch (error: any) {
      console.error('[workflow] ❌ Error advancing workflow:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send email for a workflow step
   */
  private async sendStepEmail(orderId: string, step: WorkflowStep): Promise<void> {
    try {
      const order = await this.getOrderDetails(orderId);
      if (!order || !order.customer_email) {
        console.warn(`[workflow] ⚠️ No customer email found for order ${orderId}`);
        return;
      }

      const event: OrderStatusChangeEvent = {
        orderId,
        orderNumber: order.order_number || orderId,
        orderType: order.order_type,
        previousStatus: order.previous_status || '',
        newStatus: step.status,
        customerEmail: order.customer_email,
        customerName: order.customer_name,
        orderData: order
      };

      await triggerOrderStatusEmail(this.db, this.mongoClient, event);
      console.log(`[workflow] 📧 Email sent for step: ${step.templateKey}`);

    } catch (error) {
      console.error(`[workflow] ❌ Failed to send email for step ${step.status}:`, error);
    }
  }

  /**
   * Schedule automatic advancement after a delay
   */
  private async scheduleAutoAdvancement(orderId: string, delayMs: number): Promise<void> {
    console.log(`[workflow] ⏰ Scheduling auto-advance for order ${orderId} in ${delayMs/1000/60} minutes`);
    
    setTimeout(async () => {
      try {
        const order = await this.getOrderDetails(orderId);
        if (order) {
          await this.advanceWorkflow(orderId, order.status, false);
        }
      } catch (error) {
        console.error(`[workflow] ❌ Auto-advance failed for order ${orderId}:`, error);
      }
    }, delayMs);
  }

  /**
   * Schedule manual approval handling (reminders and timeout actions)
   */
  private async scheduleManualApprovalHandling(orderId: string, step: WorkflowStep): Promise<void> {
    console.log(`[workflow] 📋 Setting up manual approval handling for order ${orderId}, step ${step.status}`);

    // Schedule reminder emails
    if (step.reminderEmails) {
      step.reminderEmails.intervals.forEach((interval, index) => {
        setTimeout(async () => {
          try {
            await this.sendReminderEmail(orderId, step, index + 1);
          } catch (error) {
            console.error(`[workflow] ❌ Failed to send reminder ${index + 1} for order ${orderId}:`, error);
          }
        }, interval);
      });
    }

    // Schedule timeout action
    if (step.manualApprovalTimeout && step.fallbackAction) {
      setTimeout(async () => {
        try {
          await this.handleManualApprovalTimeout(orderId, step);
        } catch (error) {
          console.error(`[workflow] ❌ Failed to handle timeout for order ${orderId}:`, error);
        }
      }, step.manualApprovalTimeout);
    }
  }

  /**
   * Send reminder email for pending manual approval
   */
  private async sendReminderEmail(orderId: string, step: WorkflowStep, reminderNumber: number): Promise<void> {
    console.log(`[workflow] 📧 Sending reminder ${reminderNumber} for order ${orderId}, step ${step.status}`);

    const order = await this.getOrderDetails(orderId);
    if (!order) return;

    // Check if step is still current (hasn't been manually advanced)
    if (order.status !== step.status) {
      console.log(`[workflow] ⏭️ Order ${orderId} has moved past ${step.status}, skipping reminder`);
      return;
    }

    const reminderSubject = this.getReminderSubject(step.status, reminderNumber);
    const reminderMessage = this.getReminderMessage(order, step, reminderNumber);

    // Send to appropriate recipients
    const recipients = this.getReminderRecipients(order, step.reminderEmails?.recipients || 'technician');

    for (const recipient of recipients) {
      // You could create specific reminder email templates or use a generic one
      // For now, using a simple notification
      console.log(`[workflow] 📬 Sending reminder to ${recipient.email}: ${reminderSubject}`);
      
      // Here you would send the actual email
      // await this.notificationService.send({
      //   to: recipient.email,
      //   subject: reminderSubject,
      //   text: reminderMessage
      // });
    }

    // Log the reminder
    await this.logWorkflowEvent(orderId, 'reminder_sent', {
      step: step.status,
      reminderNumber,
      recipients: recipients.map(r => r.email)
    });
  }

  /**
   * Handle manual approval timeout
   */
  private async handleManualApprovalTimeout(orderId: string, step: WorkflowStep): Promise<void> {
    console.log(`[workflow] ⏰ Handling timeout for order ${orderId}, step ${step.status}`);

    const order = await this.getOrderDetails(orderId);
    if (!order) return;

    // Check if step is still current
    if (order.status !== step.status) {
      console.log(`[workflow] ✅ Order ${orderId} has moved past ${step.status}, timeout no longer relevant`);
      return;
    }

    switch (step.fallbackAction) {
      case 'auto_advance':
        console.log(`[workflow] ⏭️ Auto-advancing order ${orderId} due to timeout`);
        await this.advanceWorkflow(orderId, step.status, false);
        break;

      case 'escalate':
        console.log(`[workflow] 🚨 Escalating order ${orderId} due to timeout`);
        await this.escalateOrder(orderId, step, 'manual_approval_timeout');
        break;

      case 'hold':
        console.log(`[workflow] ⏸️ Putting order ${orderId} on hold due to timeout`);
        await this.holdOrder(orderId, step, 'manual_approval_timeout');
        break;

      case 'cancel':
        console.log(`[workflow] ❌ Cancelling order ${orderId} due to timeout`);
        await this.cancelOrder(orderId, step, 'manual_approval_timeout');
        break;

      default:
        console.log(`[workflow] ⚠️ No fallback action defined for order ${orderId}, step ${step.status}`);
    }

    // Log the timeout action
    await this.logWorkflowEvent(orderId, 'manual_approval_timeout', {
      step: step.status,
      fallbackAction: step.fallbackAction,
      timeoutDuration: step.manualApprovalTimeout
    });
  }

  /**
   * Get reminder subject based on step and reminder number
   */
  private getReminderSubject(status: string, reminderNumber: number): string {
    const statusMap: Record<string, string> = {
      'survey_scheduled': 'Site Survey',
      'ready_to_install': 'Installation',
      'scheduled': 'Service Change'
    };

    const stepName = statusMap[status] || status;
    return `Reminder ${reminderNumber}: ${stepName} Pending`;
  }

  /**
   * Get reminder message content
   */
  private getReminderMessage(order: any, step: WorkflowStep, reminderNumber: number): string {
    const urgency = reminderNumber > 2 ? 'URGENT: ' : '';
    return `${urgency}Order ${order.order_number} is waiting for ${step.status} completion. Please take action soon to avoid delays.`;
  }

  /**
   * Get reminder recipients based on configuration
   */
  private getReminderRecipients(order: any, recipientType: string): Array<{email: string, role: string}> {
    const recipients: Array<{email: string, role: string}> = [];

    switch (recipientType) {
      case 'customer':
        if (order.customer_email) {
          recipients.push({ email: order.customer_email, role: 'customer' });
        }
        break;
      
      case 'technician':
        // You'd get technician email from assignment or default
        const techEmail = order.assigned_technician_email || process.env.DEFAULT_TECHNICIAN_EMAIL;
        if (techEmail) {
          recipients.push({ email: techEmail, role: 'technician' });
        }
        break;
      
      case 'operations':
        const opsEmail = process.env.OPERATIONS_EMAIL;
        if (opsEmail) {
          recipients.push({ email: opsEmail, role: 'operations' });
        }
        break;
      
      case 'all':
        // Combine all recipient types
        recipients.push(...this.getReminderRecipients(order, 'customer'));
        recipients.push(...this.getReminderRecipients(order, 'technician'));
        recipients.push(...this.getReminderRecipients(order, 'operations'));
        break;
    }

    return recipients;
  }

  /**
   * Escalate order when timeout occurs
   */
  private async escalateOrder(orderId: string, step: WorkflowStep, reason: string): Promise<void> {
    // Update order status to escalated
    await this.db.query(`
      UPDATE orders 
      SET 
        status = 'escalated',
        escalation_reason = $1,
        escalated_at = NOW(),
        updated_at = NOW()
      WHERE id = $2
    `, [reason, orderId]);

    // Create escalation record (if you have escalation system)
    // await this.createEscalation(orderId, step.status, reason);

    console.log(`[workflow] 🚨 Order ${orderId} escalated due to: ${reason}`);
  }

  /**
   * Put order on hold
   */
  private async holdOrder(orderId: string, step: WorkflowStep, reason: string): Promise<void> {
    await this.db.query(`
      UPDATE orders 
      SET 
        status = 'on_hold',
        hold_reason = $1,
        held_at = NOW(),
        updated_at = NOW()
      WHERE id = $2
    `, [reason, orderId]);

    console.log(`[workflow] ⏸️ Order ${orderId} put on hold due to: ${reason}`);
  }

  /**
   * Cancel order
   */
  private async cancelOrder(orderId: string, step: WorkflowStep, reason: string): Promise<void> {
    await this.db.query(`
      UPDATE orders 
      SET 
        status = 'cancelled',
        cancellation_reason = $1,
        cancelled_at = NOW(),
        updated_at = NOW()
      WHERE id = $2
    `, [reason, orderId]);

    console.log(`[workflow] ❌ Order ${orderId} cancelled due to: ${reason}`);
  }

  /**
   * Get order details from database
   */
  private async getOrderDetails(orderId: string): Promise<any> {
    const result = await this.db.query(`
      SELECT 
        o.*,
        c.first_name || ' ' || c.last_name as customer_name,
        c.email as customer_email,
        c.phone as customer_phone
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.id = $1
    `, [orderId]);

    return result.rows[0] || null;
  }

  /**
   * Update order status in database
   */
  private async updateOrderStatus(orderId: string, newStatus: string): Promise<void> {
    await this.db.query(`
      UPDATE orders 
      SET 
        status = $1, 
        previous_status = status,
        updated_at = NOW()
      WHERE id = $2
    `, [newStatus, orderId]);
  }

  /**
   * Log workflow events for tracking
   */
  private async logWorkflowEvent(orderId: string, eventType: string, data: any): Promise<void> {
    try {
      await this.db.query(`
        INSERT INTO order_workflow_log (order_id, event_type, event_data, created_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT DO NOTHING
      `, [orderId, eventType, JSON.stringify(data)]);
    } catch (error) {
      console.warn('[workflow] Failed to log workflow event:', error);
    }
  }

  /**
   * Get workflow status for an order
   */
  async getWorkflowStatus(orderId: string): Promise<{
    currentStep?: WorkflowStep;
    nextStep?: WorkflowStep;
    progress: number;
    canAdvance: boolean;
  }> {
    const order = await this.getOrderDetails(orderId);
    if (!order) {
      return { progress: 0, canAdvance: false };
    }

    const workflow = this.workflows[order.order_type];
    if (!workflow) {
      return { progress: 0, canAdvance: false };
    }

    const currentStepIndex = workflow.steps.findIndex(step => step.status === order.status);
    if (currentStepIndex === -1) {
      return { progress: 0, canAdvance: false };
    }

    const currentStep = workflow.steps[currentStepIndex];
    const nextStep = workflow.steps[currentStepIndex + 1];
    const progress = ((currentStepIndex + 1) / workflow.steps.length) * 100;
    const canAdvance = currentStep ? (!currentStep.requiresManualApproval || nextStep !== undefined) : false;

    const result: {
      currentStep?: WorkflowStep;
      nextStep?: WorkflowStep;
      progress: number;
      canAdvance: boolean;
    } = {
      progress,
      canAdvance
    };

    if (currentStep) {
      result.currentStep = currentStep;
    }
    if (nextStep) {
      result.nextStep = nextStep;
    }

    return result;
  }

  /**
   * Initialize workflow tables
   */
  async initialize(): Promise<void> {
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS order_workflow_log (
        id SERIAL PRIMARY KEY,
        order_id UUID NOT NULL,
        event_type VARCHAR(100) NOT NULL,
        event_data JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_workflow_log_order_id ON order_workflow_log(order_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_log_created_at ON order_workflow_log(created_at);
    `;
    
    await this.db.query(createTableQuery);
    console.log('[workflow] ✅ Workflow service initialized');
  }
}

// Export helper functions
export async function startOrderWorkflow(
  db: Pool, 
  mongoClient: any, 
  orderId: string, 
  orderType: 'new_installation' | 'service_change'
) {
  const service = new OrderWorkflowService(db, mongoClient);
  return await service.startWorkflow(orderId, orderType);
}

export async function advanceOrderWorkflow(
  db: Pool, 
  mongoClient: any, 
  orderId: string, 
  currentStatus: string,
  manualAdvance: boolean = false
) {
  const service = new OrderWorkflowService(db, mongoClient);
  return await service.advanceWorkflow(orderId, currentStatus, manualAdvance);
}
