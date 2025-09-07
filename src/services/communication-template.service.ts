import { MongoClient } from 'mongodb';

export interface CommunicationTemplate {
  id: string;
  name: string;
  type: 'email' | 'sms' | 'push';
  subject?: string;
  body: string;
  variables: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CommunicationCampaign {
  id: string;
  name: string;
  templateId: string;
  triggerEvent: string;
  targetAudience: string;
  isActive: boolean;
  createdAt: Date;
}

export class CommunicationTemplateService {
  private mongoClient: MongoClient;
  private db: any;

  constructor(mongoClient: MongoClient, dbName: string = 'oms_db') {
    this.mongoClient = mongoClient;
    this.db = mongoClient.db(dbName);
  }

  async createTemplate(template: Omit<CommunicationTemplate, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const collection = this.db.collection('communication_templates');
    
    const doc = {
      ...template,
      id: this.generateId(),
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    const result = await collection.insertOne(doc);
    return result.insertedId.toString();
  }

  async getTemplate(templateId: string): Promise<CommunicationTemplate | null> {
    const collection = this.db.collection('communication_templates');
    return await collection.findOne({ id: templateId });
  }

  async getTemplatesByType(type: string): Promise<CommunicationTemplate[]> {
    const collection = this.db.collection('communication_templates');
    return await collection.find({ type, isActive: true }).toArray();
  }

  async updateTemplate(templateId: string, updates: Partial<CommunicationTemplate>): Promise<void> {
    const collection = this.db.collection('communication_templates');
    
    await collection.updateOne(
      { id: templateId },
      {
        $set: {
          ...updates,
          updatedAt: new Date()
        }
      }
    );
  }

  async generateMessage(templateId: string, variables: Record<string, string>): Promise<{ subject?: string; body: string }> {
    const template = await this.getTemplate(templateId);
    if (!template) {
      throw new Error('Template not found');
    }

    let body = template.body;
    let subject = template.subject;

    // Replace variables in template
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      body = body.replace(new RegExp(placeholder, 'g'), value);
      if (subject) {
        subject = subject.replace(new RegExp(placeholder, 'g'), value);
      }
    }

    return { subject, body };
  }

  async createCampaign(campaign: Omit<CommunicationCampaign, 'id' | 'createdAt'>): Promise<string> {
    const collection = this.db.collection('communication_campaigns');
    
    const doc = {
      ...campaign,
      id: this.generateId(),
      createdAt: new Date()
    };
    
    const result = await collection.insertOne(doc);
    return result.insertedId.toString();
  }

  async getActiveCampaigns(): Promise<CommunicationCampaign[]> {
    const collection = this.db.collection('communication_campaigns');
    return await collection.find({ isActive: true }).toArray();
  }

  async triggerCampaign(triggerEvent: string, context: any): Promise<void> {
    const campaigns = await this.getActiveCampaigns();
    const relevantCampaigns = campaigns.filter(c => c.triggerEvent === triggerEvent);
    
    for (const campaign of relevantCampaigns) {
      await this.executeCampaign(campaign, context);
    }
  }

  private async executeCampaign(campaign: CommunicationCampaign, context: any): Promise<void> {
    const template = await this.getTemplate(campaign.templateId);
    if (!template) return;

    const message = await this.generateMessage(campaign.templateId, context);
    
    // TODO: Send message via appropriate channel (email, SMS, push)
    console.log(`Executing campaign ${campaign.name}:`, message);
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}
