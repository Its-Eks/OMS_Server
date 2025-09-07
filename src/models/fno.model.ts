export interface FNO {
  id: string;
  name: string;
  code: string;
  contactEmail: string;
  contactPhone: string;
  apiEndpoint?: string;
  apiKey?: string;
  integrationType: 'api' | 'manual' | 'both';
  coverageAreas: CoverageArea[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CoverageArea {
  id: string;
  fnoId: string;
  areaName: string;
  postalCodes: string[];
  coordinates?: {
    center: { latitude: number; longitude: number };
    radius: number; // in kilometers
  };
}

export interface FNOCommunication {
  id: string;
  orderId: string;
  fnoId: string;
  messageType: 'order_submission' | 'status_update' | 'query' | 'response';
  direction: 'outbound' | 'inbound';
  payload: any;
  status: 'sent' | 'delivered' | 'failed' | 'received';
  responsePayload?: any;
  timestamp: Date;
  retryCount: number;
}
