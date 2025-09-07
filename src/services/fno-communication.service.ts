import { MongoClient } from 'mongodb';
import type { FNOCommunication } from '../models/fno.model';

export class FNOCommunicationService {
  private mongoClient: MongoClient;
  private db: any;

  constructor(mongoClient: MongoClient, dbName: string = 'oms_db') {
    this.mongoClient = mongoClient;
    this.db = mongoClient.db(dbName);
  }

  async logCommunication(communication: Omit<FNOCommunication, 'id' | 'timestamp'>): Promise<string> {
    const collection = this.db.collection('fno_communications');
    const doc = {
      ...communication,
      timestamp: new Date(),
    };
    
    const result = await collection.insertOne(doc);
    return result.insertedId.toString();
  }

  async getCommunicationsByOrder(orderId: string): Promise<FNOCommunication[]> {
    const collection = this.db.collection('fno_communications');
    return await collection.find({ orderId }).sort({ timestamp: -1 }).toArray();
  }

  async getCommunicationsByFNO(fnoId: string, limit: number = 100): Promise<FNOCommunication[]> {
    const collection = this.db.collection('fno_communications');
    return await collection.find({ fnoId }).sort({ timestamp: -1 }).limit(limit).toArray();
  }

  async updateCommunicationStatus(communicationId: string, status: string, responsePayload?: any): Promise<void> {
    const collection = this.db.collection('fno_communications');
    const updateDoc: any = { status };
    if (responsePayload) {
      updateDoc.responsePayload = responsePayload;
    }
    
    await collection.updateOne(
      { _id: communicationId },
      { $set: updateDoc }
    );
  }
}
