import type { Order, OrderStatus } from '../models/order.model.ts';

export interface WorkflowTransition {
  from: OrderStatus;
  to: OrderStatus;
  condition?: (order: Order) => boolean;
  action?: (order: Order) => Promise<void>;
}

export class WorkflowEngineService {
  private transitions: WorkflowTransition[] = [
    // PRD-aligned workflow: created → validated → enriched → fno_submitted → fno_accepted → installation_scheduled → in_progress → installed → activated → completed
    { from: 'created', to: 'validated' },
    { from: 'validated', to: 'enriched' },
    { from: 'enriched', to: 'fno_submitted' },
    { from: 'fno_submitted', to: 'fno_accepted' },
    { from: 'fno_submitted', to: 'fno_rejected' },
    { from: 'fno_accepted', to: 'installation_scheduled' },
    { from: 'installation_scheduled', to: 'in_progress' },
    { from: 'in_progress', to: 'installed' },
    { from: 'installed', to: 'activated' },
    { from: 'activated', to: 'completed' },
    // Cancellation can happen from most states (PRD requirement)
    { from: 'created', to: 'cancelled' },
    { from: 'validated', to: 'cancelled' },
    { from: 'enriched', to: 'cancelled' },
    { from: 'fno_submitted', to: 'cancelled' },
    { from: 'fno_accepted', to: 'cancelled' },
    { from: 'installation_scheduled', to: 'cancelled' },
    { from: 'in_progress', to: 'cancelled' },
    // PRD: Allow direct transitions for efficiency (e.g., skip enrichment if not needed)
    { from: 'validated', to: 'fno_submitted' },
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
      'created',
      'validated',
      'enriched',
      'fno_submitted',
      'fno_accepted',
      'installation_scheduled',
      'in_progress',
      'installed',
      'activated',
      'completed'
    ];
  }
}
