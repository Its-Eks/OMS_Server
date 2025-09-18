import { Client, logger } from 'camunda-external-task-client-js';
import type { Pool } from 'pg';

export interface CamundaProcessDefinition {
  id: string;
  key: string;
  name: string;
  version: number;
  deploymentId: string;
  resource: string;
  diagram: string;
  suspended: boolean;
  tenantId?: string;
  versionTag?: string;
  historyTimeToLive?: number;
  startableInTasklist: boolean;
}

export interface CamundaProcessInstance {
  id: string;
  definitionId: string;
  businessKey?: string;
  caseInstanceId?: string;
  ended: boolean;
  suspended: boolean;
  tenantId?: string;
  links: any[];
}

export interface CamundaTask {
  id: string;
  name: string;
  assignee?: string;
  created: string;
  due?: string;
  followUp?: string;
  delegationState?: string;
  description?: string;
  executionId: string;
  owner?: string;
  parentTaskId?: string;
  priority: number;
  processDefinitionId: string;
  processInstanceId: string;
  taskDefinitionKey: string;
  caseExecutionId?: string;
  caseInstanceId?: string;
  caseDefinitionId?: string;
  suspended: boolean;
  formKey?: string;
  tenantId?: string;
}

export interface CamundaVariable {
  value: any;
  type: string;
  valueInfo?: any;
}

export class CamundaBPMService {
  private client: Client;
  private db: Pool;
  private baseUrl: string;
  private isConnected: boolean = false;

  constructor(db: Pool, baseUrl: string = 'http://localhost:8080/engine-rest') {
    this.db = db;
    this.baseUrl = baseUrl;
    
    // Configure Camunda client
    this.client = new Client({
      baseUrl: baseUrl,
      use: logger,
      asyncResponseTimeout: 10000,
      maxTasks: 1,
      workerId: 'oms-worker',
      lockDuration: 10000,
      interceptors: [
        (client, next) => {
          console.log(`[camunda] Request to ${client.baseUrl}`);
          return next();
        }
      ]
    });
  }

  // Initialize connection to Camunda
  async initialize(): Promise<void> {
    try {
      // Test connection
      await this.testConnection();
      this.isConnected = true;
      console.log('[camunda] Successfully connected to Camunda BPM');
    } catch (error) {
      console.warn('[camunda] Failed to connect to Camunda BPM:', error);
      this.isConnected = false;
    }
  }

  // Test connection to Camunda
  private async testConnection(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/version`);
    if (!response.ok) {
      throw new Error(`Camunda connection failed: ${response.statusText}`);
    }
  }

  // Deploy BPMN process definition
  async deployProcessDefinition(bpmnXml: string, processName: string): Promise<CamundaProcessDefinition> {
    if (!this.isConnected) {
      throw new Error('Camunda BPM not connected');
    }

    const formData = new FormData();
    const blob = new Blob([bpmnXml], { type: 'application/xml' });
    formData.append('deployment-name', `oms-${processName}-${Date.now()}`);
    formData.append('deployment-source', 'oms-workflow');
    formData.append('deployment-resource-name', `${processName}.bpmn`);
    formData.append('deployment-resource', blob);

    const response = await fetch(`${this.baseUrl}/deployment/create`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Failed to deploy process: ${response.statusText}`);
    }

    const deployment = await response.json();
    return deployment.deployedProcessDefinitions[processName];
  }

  // Start process instance
  async startProcessInstance(
    processDefinitionKey: string, 
    businessKey: string, 
    variables: Record<string, CamundaVariable> = {}
  ): Promise<CamundaProcessInstance> {
    if (!this.isConnected) {
      throw new Error('Camunda BPM not connected');
    }

    const response = await fetch(`${this.baseUrl}/process-definition/key/${processDefinitionKey}/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        businessKey,
        variables
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to start process: ${response.statusText}`);
    }

    return await response.json();
  }

  // Get process instance
  async getProcessInstance(processInstanceId: string): Promise<CamundaProcessInstance> {
    if (!this.isConnected) {
      throw new Error('Camunda BPM not connected');
    }

    const response = await fetch(`${this.baseUrl}/process-instance/${processInstanceId}`);
    if (!response.ok) {
      throw new Error(`Failed to get process instance: ${response.statusText}`);
    }

    return await response.json();
  }

  // Get active tasks for process instance
  async getActiveTasks(processInstanceId: string): Promise<CamundaTask[]> {
    if (!this.isConnected) {
      throw new Error('Camunda BPM not connected');
    }

    const response = await fetch(`${this.baseUrl}/task?processInstanceId=${processInstanceId}`);
    if (!response.ok) {
      throw new Error(`Failed to get tasks: ${response.statusText}`);
    }

    return await response.json();
  }

  // Complete task
  async completeTask(taskId: string, variables: Record<string, CamundaVariable> = {}): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Camunda BPM not connected');
    }

    const response = await fetch(`${this.baseUrl}/task/${taskId}/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        variables
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to complete task: ${response.statusText}`);
    }
  }

  // Set process variables
  async setProcessVariables(
    processInstanceId: string, 
    variables: Record<string, CamundaVariable>
  ): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Camunda BPM not connected');
    }

    const response = await fetch(`${this.baseUrl}/process-instance/${processInstanceId}/variables`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        modifications: variables
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to set variables: ${response.statusText}`);
    }
  }

  // Get process variables
  async getProcessVariables(processInstanceId: string): Promise<Record<string, CamundaVariable>> {
    if (!this.isConnected) {
      throw new Error('Camunda BPM not connected');
    }

    const response = await fetch(`${this.baseUrl}/process-instance/${processInstanceId}/variables`);
    if (!response.ok) {
      throw new Error(`Failed to get variables: ${response.statusText}`);
    }

    return await response.json();
  }

  // Cancel process instance
  async cancelProcessInstance(processInstanceId: string, reason?: string): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Camunda BPM not connected');
    }

    const response = await fetch(`${this.baseUrl}/process-instance/${processInstanceId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        reason: reason || 'Cancelled by OMS'
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to cancel process: ${response.statusText}`);
    }
  }

  // Subscribe to external tasks
  async subscribeToExternalTasks(
    topicName: string,
    handler: (task: any) => Promise<void>
  ): Promise<void> {
    if (!this.isConnected) {
      console.warn('[camunda] Cannot subscribe to external tasks - not connected');
      return;
    }

    this.client.subscribe(topicName, async ({ task, taskService }) => {
      try {
        console.log(`[camunda] Processing external task: ${task.id} for topic: ${topicName}`);
        await handler(task);
        await taskService.complete(task);
      } catch (error) {
        console.error(`[camunda] Error processing external task ${task.id}:`, error);
        await taskService.handleFailure(task, {
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          errorDetails: error instanceof Error ? error.stack : undefined,
          retries: 3,
          retryTimeout: 5000
        });
      }
    });
  }

  // Generate BPMN XML for order workflow
  generateOrderWorkflowBPMN(workflowDefinition: any): string {
    const { name, states, transitions } = workflowDefinition;
    
    let bpmnXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" 
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" 
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" 
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI" 
                  id="Definitions_1" 
                  targetNamespace="http://bpmn.io/schema/bpmn" 
                  exporter="Camunda Modeler" 
                  exporterVersion="5.0.0">
  <bpmn:process id="${name.toLowerCase().replace(/\s+/g, '_')}" name="${name}" isExecutable="true">
`;

    // Add start event
    bpmnXml += `    <bpmn:startEvent id="StartEvent_1" name="Order Created">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
`;

    // Add user tasks for each state
    let flowCounter = 1;
    const stateMap = new Map();
    
    states.forEach((state: any, index: number) => {
      const stateId = `Task_${index + 1}`;
      stateMap.set(state.stateName, stateId);
      
      if (state.stateType === 'start') {
        bpmnXml += `    <bpmn:userTask id="${stateId}" name="${state.displayName}">
      <bpmn:incoming>Flow_${flowCounter}</bpmn:incoming>
      <bpmn:outgoing>Flow_${flowCounter + 1}</bpmn:outgoing>
    </bpmn:userTask>
`;
      } else if (state.stateType === 'end') {
        bpmnXml += `    <bpmn:endEvent id="EndEvent_1" name="Order Completed">
      <bpmn:incoming>Flow_${flowCounter}</bpmn:incoming>
    </bpmn:endEvent>
`;
      } else {
        bpmnXml += `    <bpmn:userTask id="${stateId}" name="${state.displayName}">
      <bpmn:incoming>Flow_${flowCounter}</bpmn:incoming>
      <bpmn:outgoing>Flow_${flowCounter + 1}</bpmn:outgoing>
    </bpmn:userTask>
`;
      }
      
      flowCounter++;
    });

    // Add sequence flows
    flowCounter = 1;
    states.forEach((state: any, index: number) => {
      if (index === 0) {
        bpmnXml += `    <bpmn:sequenceFlow id="Flow_${flowCounter}" sourceRef="StartEvent_1" targetRef="Task_1" />
`;
      } else if (index === states.length - 1) {
        bpmnXml += `    <bpmn:sequenceFlow id="Flow_${flowCounter}" sourceRef="Task_${index}" targetRef="EndEvent_1" />
`;
      } else {
        bpmnXml += `    <bpmn:sequenceFlow id="Flow_${flowCounter}" sourceRef="Task_${index}" targetRef="Task_${index + 1}" />
`;
      }
      flowCounter++;
    });

    bpmnXml += `  </bpmn:process>
</bpmn:definitions>`;

    return bpmnXml;
  }

  // Check if Camunda is available
  isAvailable(): boolean {
    return this.isConnected;
  }

  // Get Camunda version
  async getVersion(): Promise<string> {
    if (!this.isConnected) {
      throw new Error('Camunda BPM not connected');
    }

    const response = await fetch(`${this.baseUrl}/version`);
    if (!response.ok) {
      throw new Error(`Failed to get version: ${response.statusText}`);
    }

    const version = await response.json();
    return version.version;
  }
}
