import type { Order, OrderStatus } from '../models/order.model';

export interface WorkflowTransition {
  from: OrderStatus;
  to: OrderStatus;
  condition?: (order: Order) => boolean;
  action?: (order: Order) => Promise<void>;
}

export class WorkflowEngineService {
  private transitions: WorkflowTransition[] = [
    { from: 'draft', to: 'pending_validation' },
    { from: 'pending_validation', to: 'validated' },
    { from: 'validated', to: 'submitted_to_fno' },
    { from: 'submitted_to_fno', to: 'fno_accepted' },
    { from: 'submitted_to_fno', to: 'fno_rejected' },
    { from: 'fno_accepted', to: 'installation_scheduled' },
    { from: 'installation_scheduled', to: 'installation_in_progress' },
    { from: 'installation_in_progress', to: 'installation_completed' },
    { from: 'installation_completed', to: 'service_active' },
    { from: 'service_active', to: 'completed' },
    // Cancellation can happen from most states
    { from: 'pending_validation', to: 'cancelled' },
    { from: 'validated', to: 'cancelled' },
    { from: 'submitted_to_fno', to: 'cancelled' },
    { from: 'fno_accepted', to: 'cancelled' },
    { from: 'installation_scheduled', to: 'cancelled' },
    { from: 'installation_in_progress', to: 'cancelled' },
  ];

  getValidTransitions(currentStatus: OrderStatus): OrderStatus[] {
    return this.transitions
      .filter(t => t.from === currentStatus)
      .map(t => t.to);
  }

  canTransition(from: OrderStatus, to: OrderStatus): boolean {
    return this.transitions.some(t => t.from === from && t.to === to);
  }

  async transitionOrder(order: Order, newStatus: OrderStatus): Promise<Order> {
    if (!this.canTransition(order.status, newStatus)) {
      throw new Error(`Invalid transition from ${order.status} to ${newStatus}`);
    }

    const transition = this.transitions.find(t => t.from === order.status && t.to === newStatus);
    
    if (transition?.condition && !transition.condition(order)) {
      throw new Error(`Transition condition not met for ${order.status} to ${newStatus}`);
    }

    if (transition?.action) {
      await transition.action(order);
    }

    return {
      ...order,
      status: newStatus,
      updatedAt: new Date()
    };
  }

  getOrderLifecycleStatuses(): OrderStatus[] {
    return [
      'draft',
      'pending_validation',
      'validated',
      'submitted_to_fno',
      'fno_accepted',
      'installation_scheduled',
      'installation_in_progress',
      'installation_completed',
      'service_active',
      'completed'
    ];
  }
}
