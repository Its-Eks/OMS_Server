// Unified state mapping system for trial orders
// This ensures consistency between database status, current_state, and workflow states

export type TrialStatus = 
  | 'created'
  | 'trial_order_created'
  | 'trial_fno_provisioning'
  | 'trial_installation_pending'
  | 'trial_installation_scheduled'
  | 'trial_device_shipping'
  | 'trial_device_delivered'
  | 'trial_self_install'
  | 'trial_active'
  | 'trial_engaged'
  | 'trial_expiring'
  | 'trial_converted'
  | 'trial_expired'
  | 'trial_cancelled'
  | 'paid_service_installation_pending'
  | 'paid_service_installation_scheduled'
  | 'paid_service_device_shipping'
  | 'paid_service_device_delivered'
  | 'paid_service_self_install'
  | 'paid_service_active'
  | 'completed'
  | 'cancelled';

// Mapping from workflow states to database status
export const WORKFLOW_TO_STATUS: Record<string, string> = {
  'trial_order_created': 'created',
  'trial_fno_provisioning': 'trial_fno_provisioning',
  'trial_installation_pending': 'trial_installation_pending',
  'trial_installation_scheduled': 'trial_installation_scheduled',
  'trial_device_shipping': 'trial_device_shipping',
  'trial_device_delivered': 'trial_device_delivered',
  'trial_self_install': 'trial_self_install',
  'trial_active': 'trial_active',
  'trial_engaged': 'trial_engaged',
  'trial_expiring': 'trial_expiring',
  'trial_converted': 'trial_converted',
  'trial_expired': 'trial_expired',
  'trial_cancelled': 'trial_cancelled',
  'paid_service_installation_pending': 'paid_service_installation_pending',
  'paid_service_installation_scheduled': 'paid_service_installation_scheduled',
  'paid_service_device_shipping': 'paid_service_device_shipping',
  'paid_service_device_delivered': 'paid_service_device_delivered',
  'paid_service_self_install': 'paid_service_self_install',
  'paid_service_active': 'paid_service_active',
  'completed': 'completed',
  'cancelled': 'cancelled'
};

// Mapping from database status to workflow states
export const STATUS_TO_WORKFLOW: Record<string, string> = {
  'created': 'trial_order_created',
  'trial_fno_provisioning': 'trial_fno_provisioning',
  'trial_installation_pending': 'trial_installation_pending',
  'trial_installation_scheduled': 'trial_installation_scheduled',
  'trial_device_shipping': 'trial_device_shipping',
  'trial_device_delivered': 'trial_device_delivered',
  'trial_self_install': 'trial_self_install',
  'trial_active': 'trial_active',
  'trial_engaged': 'trial_engaged',
  'trial_expiring': 'trial_expiring',
  'trial_converted': 'trial_converted',
  'trial_expired': 'trial_expired',
  'trial_cancelled': 'trial_cancelled',
  'paid_service_installation_pending': 'paid_service_installation_pending',
  'paid_service_installation_scheduled': 'paid_service_installation_scheduled',
  'paid_service_device_shipping': 'paid_service_device_shipping',
  'paid_service_device_delivered': 'paid_service_device_delivered',
  'paid_service_self_install': 'paid_service_self_install',
  'paid_service_active': 'paid_service_active',
  'completed': 'completed',
  'cancelled': 'cancelled'
};

// Service-specific workflow definitions
export const FIBER_WORKFLOW_STATES = [
  'trial_order_created',
  'trial_fno_provisioning',
  'trial_installation_pending',
  'trial_installation_scheduled',
  'trial_active',
  'trial_engaged',
  'trial_expiring',
  'trial_converted'
];

export const WIRELESS_WORKFLOW_STATES = [
  'trial_order_created',
  'trial_device_shipping',
  'trial_device_delivered',
  'trial_self_install',
  'trial_active',
  'trial_engaged',
  'trial_expiring',
  'trial_converted'
];

// Get the correct workflow states based on service type
export function getWorkflowStatesForServiceType(serviceType: string): string[] {
  const serviceTypeLower = serviceType.toLowerCase();
  
  if (serviceTypeLower === 'wireless') {
    return WIRELESS_WORKFLOW_STATES;
  } else {
    return FIBER_WORKFLOW_STATES;
  }
}

// Convert workflow state to database status
export function workflowToStatus(workflowState: string): string {
  return WORKFLOW_TO_STATUS[workflowState] || workflowState;
}

// Convert database status to workflow state
export function statusToWorkflow(status: string): string {
  return STATUS_TO_WORKFLOW[status] || status;
}

// Get the next possible states for a given current state and service type
export function getNextStatesForWorkflow(currentState: string, serviceType: string): string[] {
  const workflowStates = getWorkflowStatesForServiceType(serviceType);
  const currentIndex = workflowStates.indexOf(currentState);
  
  console.log(`[STATE MAPPING] DEBUG - currentState: "${currentState}"`);
  console.log(`[STATE MAPPING] DEBUG - serviceType: "${serviceType}"`);
  console.log(`[STATE MAPPING] DEBUG - workflowStates:`, workflowStates);
  console.log(`[STATE MAPPING] DEBUG - currentIndex: ${currentIndex}`);
  
  if (currentIndex === -1) {
    console.log(`[STATE MAPPING] DEBUG - currentState not found in workflow, trying case-insensitive match`);
    
    // Try case-insensitive match
    const lowerCurrentState = currentState.toLowerCase();
    const lowerWorkflowStates = workflowStates.map(state => state.toLowerCase());
    const caseInsensitiveIndex = lowerWorkflowStates.indexOf(lowerCurrentState);
    
    if (caseInsensitiveIndex !== -1) {
      console.log(`[STATE MAPPING] DEBUG - Found case-insensitive match at index ${caseInsensitiveIndex}`);
      // Use the original case from workflowStates
      const actualCurrentState = workflowStates[caseInsensitiveIndex];
      return getNextStatesForWorkflow(actualCurrentState, serviceType);
    }
    
    // If still not found, try to find a partial match
    const partialMatch = workflowStates.find(state => 
      state.toLowerCase().includes(lowerCurrentState) || 
      lowerCurrentState.includes(state.toLowerCase())
    );
    
    if (partialMatch) {
      console.log(`[STATE MAPPING] DEBUG - Found partial match: "${partialMatch}"`);
      return getNextStatesForWorkflow(partialMatch, serviceType);
    }
    
    console.log(`[STATE MAPPING] DEBUG - No match found, returning common states as fallback`);
    // Fallback: return common transition states
    return ['trial_engaged', 'trial_converted', 'trial_cancelled'];
  }
  
  const nextStates: string[] = [];
  
  // Add the next state in the workflow sequence
  const nextIndex = currentIndex + 1;
  if (nextIndex < workflowStates.length) {
    const nextState = workflowStates[nextIndex];
    if (nextState) {
      nextStates.push(nextState);
    }
  }
  
  // Add common transition states that are always available
  const commonStates = ['trial_engaged', 'trial_converted', 'trial_cancelled'];
  for (const state of commonStates) {
    if (!nextStates.includes(state)) {
      nextStates.push(state);
    }
  }
  
  // For active states, also allow trial_expiring
  if (['trial_active', 'trial_engaged'].includes(currentState)) {
    if (!nextStates.includes('trial_expiring')) {
      nextStates.push('trial_expiring');
    }
  }
  
  return nextStates;
}

// Validate if a state transition is allowed
export function isTransitionAllowed(fromState: string, toState: string, serviceType: string): boolean {
  const workflowStates = getWorkflowStatesForServiceType(serviceType);
  const fromIndex = workflowStates.indexOf(fromState);
  const toIndex = workflowStates.indexOf(toState);
  
  // Allow transitions to the next state in sequence
  if (toIndex === fromIndex + 1) {
    return true;
  }
  
  // Allow transitions to common end states from any state
  const commonEndStates = ['trial_engaged', 'trial_converted', 'trial_cancelled', 'trial_expired'];
  if (commonEndStates.includes(toState)) {
    return true;
  }
  
  // Allow transitions to trial_expiring from active states
  if (toState === 'trial_expiring' && ['trial_active', 'trial_engaged'].includes(fromState)) {
    return true;
  }
  
  return false;
}
