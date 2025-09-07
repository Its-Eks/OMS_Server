import { MongoClient } from 'mongodb';

export interface Policy {
  id: string;
  name: string;
  description: string;
  category: 'order_validation' | 'escalation' | 'communication' | 'business_rule';
  rules: PolicyRule[];
  isActive: boolean;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PolicyRule {
  id: string;
  condition: string;
  action: string;
  parameters: Record<string, any>;
}

export class PolicyService {
  private mongoClient: MongoClient;
  private db: any;

  constructor(mongoClient: MongoClient, dbName: string = 'oms_db') {
    this.mongoClient = mongoClient;
    this.db = mongoClient.db(dbName);
  }

  async createPolicy(policy: Omit<Policy, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const collection = this.db.collection('policies');
    
    const doc = {
      ...policy,
      id: this.generateId(),
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    const result = await collection.insertOne(doc);
    return result.insertedId.toString();
  }

  async getPolicy(policyId: string): Promise<Policy | null> {
    const collection = this.db.collection('policies');
    return await collection.findOne({ id: policyId });
  }

  async getPoliciesByCategory(category: string): Promise<Policy[]> {
    const collection = this.db.collection('policies');
    return await collection.find({ category, isActive: true }).sort({ priority: 1 }).toArray();
  }

  async getAllActivePolicies(): Promise<Policy[]> {
    const collection = this.db.collection('policies');
    return await collection.find({ isActive: true }).sort({ priority: 1 }).toArray();
  }

  async updatePolicy(policyId: string, updates: Partial<Policy>): Promise<void> {
    const collection = this.db.collection('policies');
    
    await collection.updateOne(
      { id: policyId },
      {
        $set: {
          ...updates,
          updatedAt: new Date()
        }
      }
    );
  }

  async evaluatePolicy(context: any, category: string): Promise<PolicyRule[]> {
    const policies = await this.getPoliciesByCategory(category);
    const applicableRules: PolicyRule[] = [];

    for (const policy of policies) {
      for (const rule of policy.rules) {
        if (this.evaluateCondition(rule.condition, context)) {
          applicableRules.push(rule);
        }
      }
    }

    return applicableRules;
  }

  async executePolicyRules(rules: PolicyRule[], context: any): Promise<any[]> {
    const results = [];

    for (const rule of rules) {
      try {
        const result = await this.executeAction(rule.action, rule.parameters, context);
        results.push({ ruleId: rule.id, success: true, result });
      } catch (error) {
        results.push({ ruleId: rule.id, success: false, error: error.message });
      }
    }

    return results;
  }

  private evaluateCondition(condition: string, context: any): boolean {
    // Simple condition evaluation - in production, use a proper rule engine
    try {
      // Replace context variables in condition
      let evalCondition = condition;
      for (const [key, value] of Object.entries(context)) {
        evalCondition = evalCondition.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), JSON.stringify(value));
      }
      
      // Evaluate the condition (be careful with eval in production!)
      return eval(evalCondition);
    } catch (error) {
      console.error('Error evaluating condition:', error);
      return false;
    }
  }

  private async executeAction(action: string, parameters: Record<string, any>, context: any): Promise<any> {
    // Simple action execution - in production, use a proper action engine
    switch (action) {
      case 'send_notification':
        return { message: 'Notification sent', parameters };
      case 'escalate_order':
        return { message: 'Order escalated', parameters };
      case 'validate_order':
        return { message: 'Order validated', parameters };
      case 'update_status':
        return { message: 'Status updated', parameters };
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}
