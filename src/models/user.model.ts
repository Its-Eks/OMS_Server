export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  passwordHash?: string;
  roleId: string;
  isActive: boolean;
  emailVerified: boolean;
  firebaseUid?: string;
  loginMethod: 'email' | 'google';
  createdAt: Date;
  updatedAt: Date;
}

export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Permission {
  id: string;
  name: string;
  description: string;
  resource: string;
  action: string;
}
