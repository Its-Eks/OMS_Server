import { MongoClient } from 'mongodb';
import type { Customer, OnboardingStatus } from '../models/customer.model.ts';

export interface OnboardingStep {
  id: string;
  name: string;
  description: string;
  isRequired: boolean;
  isCompleted: boolean;
  completedAt?: Date;
  order: number;
}

export interface OnboardingWorkflow {
  id: string;
  customerId: string;
  status: OnboardingStatus;
  steps: OnboardingStep[];
  startedAt: Date;
  completedAt?: Date;
  trialEndDate?: Date;
  conversionAttempts: number;
  lastConversionAttempt?: Date;
}

export class OnboardingService {
  private mongoClient: MongoClient;
  private db: any;

  constructor(mongoClient: MongoClient, dbName: string = 'oms_db') {
    this.mongoClient = mongoClient;
    this.db = mongoClient.db(dbName);
  }

  async startOnboarding(customerId: string, trialDays: number = 30): Promise<OnboardingWorkflow> {
    const trialEndDate = new Date();
    trialEndDate.setDate(trialEndDate.getDate() + trialDays);

    const workflow: OnboardingWorkflow = {
      id: customerId,
      customerId,
      status: 'in_progress',
      steps: this.getDefaultOnboardingSteps(),
      startedAt: new Date(),
      trialEndDate,
      conversionAttempts: 0
    };

    const collection = this.db.collection('onboarding_workflows');
    await collection.insertOne(workflow);

    return workflow;
  }

  async updateOnboardingProgress(customerId: string, stepId: string): Promise<void> {
    const collection = this.db.collection('onboarding_workflows');
    
    await collection.updateOne(
      { customerId },
      {
        $set: {
          [`steps.$[step].isCompleted`]: true,
          [`steps.$[step].completedAt`]: new Date()
        }
      },
      {
        arrayFilters: [{ 'step.id': stepId }]
      }
    );

    // Check if all required steps are completed
    const workflow = await this.getOnboardingWorkflow(customerId);
    const allRequiredCompleted = workflow.steps
      .filter(step => step.isRequired)
      .every(step => step.isCompleted);

    if (allRequiredCompleted) {
      await this.completeOnboarding(customerId);
    }
  }

  async completeOnboarding(customerId: string): Promise<void> {
    const collection = this.db.collection('onboarding_workflows');
    
    await collection.updateOne(
      { customerId },
      {
        $set: {
          status: 'completed',
          completedAt: new Date()
        }
      }
    );
  }

  async getOnboardingWorkflow(customerId: string): Promise<OnboardingWorkflow | null> {
    const collection = this.db.collection('onboarding_workflows');
    return await collection.findOne({ customerId });
  }

  async getTrialCustomers(): Promise<OnboardingWorkflow[]> {
    const collection = this.db.collection('onboarding_workflows');
    const now = new Date();
    
    return await collection.find({
      status: 'in_progress',
      trialEndDate: { $gt: now }
    }).toArray();
  }

  async getExpiredTrials(): Promise<OnboardingWorkflow[]> {
    const collection = this.db.collection('onboarding_workflows');
    const now = new Date();
    
    return await collection.find({
      status: 'in_progress',
      trialEndDate: { $lte: now }
    }).toArray();
  }

  async recordConversionAttempt(customerId: string): Promise<void> {
    const collection = this.db.collection('onboarding_workflows');
    
    await collection.updateOne(
      { customerId },
      {
        $inc: { conversionAttempts: 1 },
        $set: { lastConversionAttempt: new Date() }
      }
    );
  }

  private getDefaultOnboardingSteps(): OnboardingStep[] {
    return [
      {
        id: 'welcome_email',
        name: 'Welcome Email Sent',
        description: 'Send welcome email to customer',
        isRequired: true,
        isCompleted: false,
        order: 1
      },
      {
        id: 'account_setup',
        name: 'Account Setup',
        description: 'Customer completes account setup',
        isRequired: true,
        isCompleted: false,
        order: 2
      },
      {
        id: 'service_activation',
        name: 'Service Activation',
        description: 'Service is activated and ready',
        isRequired: true,
        isCompleted: false,
        order: 3
      },
      {
        id: 'first_usage',
        name: 'First Usage',
        description: 'Customer uses the service for the first time',
        isRequired: false,
        isCompleted: false,
        order: 4
      }
    ];
  }
}
