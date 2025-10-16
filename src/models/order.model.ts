export interface Order {
  id: string;
  customerId: string;
  orderNumber: string;
  orderType: 'new_install' | 'disconnect' | 'service_change' | 'upgrade' | 'downgrade';
  status: OrderStatus;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  serviceAddress: Address;
  serviceDetails: ServiceDetails;
  fnoId?: string;
  fnoReference?: string;
  estimatedCompletionDate?: Date;
  actualCompletionDate?: Date;
  isPaid?: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  current_state?: string;
  service_type?: string;
  service_package?: string;
}

export interface Address {
  street: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
}

export interface ServiceDetails {
  serviceType: string;
  bandwidth: string;
  installationType: 'self_install' | 'professional_install';
  equipment?: string[];
  specialRequirements?: string;
  service_type?: string;
}

export type OrderStatus = 
  | 'created'
  | 'validated'
  | 'enriched'
  | 'fno_submitted'
  | 'fno_accepted'
  | 'fno_rejected'
  | 'installation_scheduled'
  | 'in_progress'
  | 'installed'
  | 'activated'
  | 'completed'
  | 'cancelled';
