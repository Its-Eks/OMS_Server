export interface Customer {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: Address;
  customerType: 'individual' | 'business';
  businessName?: string;
  businessRegistration?: string;
  isActive: boolean;
  trialEndDate?: Date;
  onboardingStatus: OnboardingStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface Address {
  street: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
}

export type OnboardingStatus = 
  | 'not_started'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'requires_manual_intervention';
