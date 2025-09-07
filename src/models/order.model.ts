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
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
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
}

export type OrderStatus = 
  | 'draft'
  | 'pending_validation'
  | 'validated'
  | 'submitted_to_fno'
  | 'fno_accepted'
  | 'fno_rejected'
  | 'installation_scheduled'
  | 'installation_in_progress'
  | 'installation_completed'
  | 'service_active'
  | 'cancelled'
  | 'completed';
