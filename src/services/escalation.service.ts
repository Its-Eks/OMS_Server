import { Pool } from 'pg';
import { MongoClient } from 'mongodb';
import { NotificationService } from './notification.service';

export interface EscalationRule {
  id: string;
  name: string;
  orderType?: string;
  fnoId?: string;
  customerTier?: string;
  timeThreshold: number; // in hours
  escalationLevel: number;
  assignedRole: string;
  isActive: boolean;
}

export interface Escalation {
  id: string;
  orderId: string;
  escalationLevel: number;
  assignedTo: string;
  assignedRole: string;
  reason: string;
  createdAt: Date;
  resolvedAt?: Date;
  status: 'pending' | 'in_progress' | 'resolved';
}

export class EscalationService {
  private db: Pool;
  private mongoClient: MongoClient;
  private mongoDb: any;
  private notificationService: NotificationService;

  constructor(db: Pool, mongoClient: MongoClient, dbName: string = 'oms_db') {
    this.db = db;
    this.mongoClient = mongoClient;
    this.mongoDb = mongoClient.db(dbName);
    this.notificationService = new NotificationService();
  }

  async checkAndEscalateOrders(): Promise<void> {
    const orders = await this.getOrdersNeedingEscalation();
    
    for (const order of orders) {
      await this.escalateOrder(order);
    }
  }

  async escalateOrder(order: any): Promise<void> {
    const escalationRule = await this.getEscalationRule(order);
    if (!escalationRule) return;

    const escalation: Escalation = {
      id: `${order.id}_${Date.now()}`,
      orderId: order.id,
      escalationLevel: escalationRule.escalationLevel,
      assignedTo: '', // Will be determined by role
      assignedRole: escalationRule.assignedRole,
      reason: `Order exceeded ${escalationRule.timeThreshold} hour threshold`,
      createdAt: new Date(),
      status: 'pending'
    };

    // Store escalation
    const collection = this.mongoDb.collection('escalations');
    await collection.insertOne(escalation);

    // Send notification
    await this.notificationService.sendEscalationNotification(escalation);

    // Log escalation
    console.log(`Order ${order.id} escalated to ${escalationRule.assignedRole}`);
  }

  async getEscalationRule(order: any): Promise<EscalationRule | null> {
    const collection = this.mongoDb.collection('escalation_rules');
    
    const rule = await collection.findOne({
      isActive: true,
      $or: [
        { orderType: order.orderType },
        { fnoId: order.fnoId },
        { customerTier: order.customerTier }
      ],
      timeThreshold: { $lte: this.getOrderAge(order) }
    });

    return rule;
  }

  async getOrdersNeedingEscalation(): Promise<any[]> {
    const result = await this.db.query(`
      SELECT o.*, 
             EXTRACT(EPOCH FROM (NOW() - o.created_at))/3600 as age_hours
      FROM orders o
      WHERE o.status NOT IN ('completed', 'cancelled')
      AND o.created_at < NOW() - INTERVAL '1 hour'
    `);

    return result.rows;
  }

  async getEscalations(status?: string): Promise<Escalation[]> {
    const collection = this.mongoDb.collection('escalations');
    const query = status ? { status } : {};
    return await collection.find(query).sort({ createdAt: -1 }).toArray();
  }

  async resolveEscalation(escalationId: string, resolvedBy: string): Promise<void> {
    const collection = this.mongoDb.collection('escalations');
    
    await collection.updateOne(
      { id: escalationId },
      {
        $set: {
          status: 'resolved',
          resolvedAt: new Date(),
          resolvedBy
        }
      }
    );
  }

  async monitorSLA(): Promise<void> {
    const orders = await this.getOrdersNeedingEscalation();
    
    for (const order of orders) {
      const slaBreach = await this.checkSLABreach(order);
      if (slaBreach) {
        await this.notificationService.sendSLABreachNotification(order);
      }
    }
  }

  private getOrderAge(order: any): number {
    const createdAt = new Date(order.created_at);
    const now = new Date();
    return (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60); // hours
  }

  private async checkSLABreach(order: any): Promise<boolean> {
    const slaHours = this.getSLAHours(order.orderType);
    const ageHours = this.getOrderAge(order);
    return ageHours > slaHours;
  }

  private getSLAHours(orderType: string): number {
    const slaMap: Record<string, number> = {
      'new_install': 48,
      'disconnect': 24,
      'service_change': 72,
      'upgrade': 24,
      'downgrade': 24
    };
    
    return slaMap[orderType] || 48; // Default 48 hours
  }
}
