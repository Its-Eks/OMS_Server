# 🎯 Complete Order-to-Escalation Workflow

## 📋 **Overview: Who Creates Orders & How Escalations Work**

### **👥 Who Creates Orders:**
1. **Customer Service Representatives** - Create orders for customers
2. **Sales Team** - Create orders for new sales
3. **System Administrators** - Create orders for system processes
4. **API Integrations** - External systems creating orders

### **🔄 Complete Workflow: Order Creation → Escalation → Resolution**

---

## **STEP 1: Order Creation** 🆕

### **Who Creates Orders:**
- **Customer Service Reps** (most common)
- **Sales Team** 
- **System Administrators**
- **API Integrations**

### **How Orders Are Created:**
```javascript
POST /orders
{
  "customerId": "customer123",
  "orderType": "new_install",
  "priority": "medium",
  "serviceAddress": {...},
  "serviceDetails": {...}
}
```

### **What Happens When Order Is Created:**
1. **Validation**: System validates order data
2. **Single Active Order Rule**: Ensures customer has only one active order
3. **Order Number Generation**: Creates unique order number (e.g., ORD-MG4RTK8X-RAZE)
4. **Database Insert**: Order saved with status "created"
5. **Workflow Instance**: Creates workflow instance for order processing
6. **A/B Testing**: Assigns order to control or variant workflow
7. **Onboarding Initiation**: Starts customer onboarding process
8. **State History**: Records initial state change

### **Order States After Creation:**
- **Status**: "created"
- **Current State**: "created" 
- **Priority**: "medium" (default)
- **Created By**: User who created the order

---

## **STEP 2: Order Processing** ⚙️

### **Workflow States (Typical Flow):**
1. **created** → Order just created
2. **validated** → Order validated and approved
3. **scheduled** → Installation scheduled
4. **in_progress** → Work in progress
5. **completed** → Order completed
6. **cancelled** → Order cancelled

### **Who Processes Orders:**
- **Individual Contributors** (ICs) - Handle specific tasks
- **Operations Managers** - Oversee and manage
- **System Administrators** - Handle complex issues

---

## **STEP 3: Escalation Triggers** ⏰

### **When Escalations Happen:**
1. **Time-Based**: Order stuck in state too long
2. **Manual**: User manually escalates
3. **SLA Breach**: Service Level Agreement violated
4. **Priority-Based**: High priority orders need attention

### **Escalation Scheduler:**
- **Runs Every 5 Minutes** (automatic)
- **Checks Orders**: Finds orders needing escalation
- **Time Threshold**: Orders older than X minutes (configurable)
- **State Filter**: Only active orders (not completed/cancelled)

### **Escalation Rules:**
```sql
-- Example escalation rule
{
  "name": "Standard Order Escalation",
  "orderType": "new_install",
  "timeThreshold": 60, -- 60 minutes
  "escalationLevel": 1,
  "assignedRole": "Operations Manager"
}
```

---

## **STEP 4: Escalation Process** 🚨

### **Automatic Escalation Flow:**
1. **Scheduler Runs** (every 5 minutes)
2. **Find Orders**: Get orders needing escalation
3. **Check Rules**: Find matching escalation rule
4. **Calculate Level**: Determine next escalation level
5. **Resolve Recipient**: Find who to assign to
6. **Create Escalation**: Insert escalation record
7. **Send Notifications**: Email assigned user
8. **Start Workflow**: Begin escalation workflow

### **Load Balancing Assignment:**
```javascript
// Who gets assigned the escalation:
1. Check escalation rules for specific role
2. Find users with that role who are active
3. Count current open escalations per user
4. Assign to user with FEWEST open escalations
5. If tied, assign to user with fewest recent assignments
6. If still tied, assign to oldest user (fair rotation)
```

### **Escalation Levels:**
- **Level 1**: Individual Contributor (IC)
- **Level 2**: Operations Manager (OM)
- **Level 3**: System Administrator (Admin)

---

## **STEP 5: Escalation Assignment** 👥

### **Who Gets Assigned:**
1. **Level 1**: Individual Contributors
2. **Level 2**: Operations Managers (most common)
3. **Level 3**: System Administrators

### **Assignment Logic:**
```javascript
// Load balancing algorithm:
1. Get all active users with target role
2. Count open escalations for each user
3. Count recent assignments (last 24 hours)
4. Assign to user with:
   - Fewest open escalations
   - Fewest recent assignments
   - Oldest user (fair rotation)
```

### **Notification Process:**
1. **Email Sent** to assigned user
2. **Role Notifications** to all users in role
3. **Fallback Email** if no user found
4. **Audit Trail** recorded

---

## **STEP 6: Escalation Management** 📊

### **Who Can See Escalations:**
- **System Administrators**: See ALL escalations
- **Operations Managers**: See their team + unassigned
- **Individual Contributors**: See their assigned + unassigned

### **Escalation Actions:**
1. **View**: See escalation details
2. **Assign**: Manually assign to someone
3. **Resolve**: Mark as resolved
4. **Escalate Further**: Escalate to next level

### **Manual Assignment:**
```javascript
POST /escalation/{id}/assign
{
  "assignedTo": "user-id",
  "assignedToName": "John Doe"
}
```

---

## **STEP 7: Resolution** ✅

### **How Escalations Are Resolved:**
1. **Automatic**: Order moves to next state
2. **Manual**: User marks as resolved
3. **Timeout**: Escalation expires
4. **Cancellation**: Order cancelled

### **Resolution Process:**
1. **Update Status**: Set to "resolved"
2. **Record Resolution**: Who resolved and when
3. **Update Order**: Move order to next state
4. **Send Notifications**: Notify stakeholders
5. **Audit Trail**: Record resolution

---

## **🔄 Complete Example Flow:**

### **Scenario: New Internet Installation Order**

1. **Order Creation** (9:00 AM)
   - Customer Service Rep creates order
   - Order status: "created"
   - Order number: ORD-ABC123-XYZ

2. **Order Processing** (9:00 AM - 10:00 AM)
   - Order moves through workflow states
   - Individual Contributor handles validation
   - Order status: "validated"

3. **Escalation Trigger** (10:05 AM)
   - Scheduler runs (every 5 minutes)
   - Order stuck in "validated" for 60+ minutes
   - Escalation rule matches: "Standard Order Escalation"

4. **Escalation Created** (10:05 AM)
   - Level 1 escalation created
   - Assigned to Operations Manager (load balancing)
   - Email sent to assigned OM

5. **Escalation Management** (10:05 AM - 11:00 AM)
   - Operations Manager sees escalation
   - Reviews order details
   - Takes action or assigns to team member

6. **Resolution** (11:00 AM)
   - Order moves to "scheduled" state
   - Escalation marked as resolved
   - Order continues normal workflow

---

## **📊 Key Metrics & Monitoring:**

### **Escalation Metrics:**
- **Total Escalations**: Count of all escalations
- **Open Escalations**: Currently unresolved
- **Resolution Time**: Average time to resolve
- **Assignment Distribution**: Load balancing effectiveness

### **Order Metrics:**
- **Order Volume**: Orders created per day
- **Processing Time**: Time from creation to completion
- **Escalation Rate**: Percentage of orders that escalate
- **SLA Compliance**: Orders meeting service level agreements

---

## **🎯 Summary:**

**The complete workflow is:**
1. **Order Created** → Customer Service/Sales creates order
2. **Order Processing** → Workflow moves through states
3. **Escalation Trigger** → Time-based or manual trigger
4. **Escalation Created** → System creates escalation record
5. **Assignment** → Load balancing assigns to Operations Manager
6. **Notification** → Email sent to assigned user
7. **Management** → User reviews and takes action
8. **Resolution** → Escalation resolved, order continues

**This ensures orders don't get stuck and Operations Managers can efficiently manage their workload!** 🚀
