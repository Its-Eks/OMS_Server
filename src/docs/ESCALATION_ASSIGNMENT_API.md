# Escalation Assignment API Documentation

## Manual Assignment Endpoint

### POST `/escalation/{id}/assign`

Manually assign an escalation to a specific user with comprehensive validation and notification.

#### Request Body
```json
{
  "assignedTo": "user123",
  "assignedToName": "John Doe"
}
```

#### Response (Success)
```json
{
  "success": true,
  "data": {
    "id": "escalation123",
    "assigned_to": "user123",
    "assigned_to_name": "John Doe", 
    "assigned_at": "2024-01-15T10:30:00Z",
    "status": "in_progress"
  }
}
```

#### Response (Error)
```json
{
  "success": false,
  "error": {
    "message": "Assigned user not found or inactive"
  }
}
```

## Assignment Logic & Validation

### 1. User Validation
- ✅ **User Exists**: Verifies assigned user exists in database
- ✅ **User Active**: Ensures user account is active (`is_active = true`)
- ✅ **Permissions Check**: Validates user has escalation permissions
- ✅ **Role Validation**: Checks user role allows escalation handling

### 2. Availability Checking
- ✅ **Workload Limits**: Prevents over-assignment (max 10 concurrent escalations)
- ✅ **Current Assignments**: Counts existing open/in_progress escalations
- ✅ **Capacity Management**: Configurable assignment limits per user

### 3. Database Updates
- ✅ **Assignment Update**: Sets `escalated_to`, `escalated_to_name`, `assigned_at`
- ✅ **Status Change**: Auto-changes status from 'open' to 'in_progress'
- ✅ **Timestamp Tracking**: Records assignment timestamp
- ✅ **Cache Invalidation**: Clears relevant caches for real-time updates

### 4. Notification System
- ✅ **Assignment Notification**: Sends email to assigned user
- ✅ **Escalation Details**: Includes escalation level, order number, service type
- ✅ **Priority Information**: Includes order priority in notification
- ✅ **Error Handling**: Graceful notification failure handling

### 5. Audit & Logging
- ✅ **Activity Logging**: Records assignment in audit trail
- ✅ **Assignment History**: Tracks previous assignee and assignment details
- ✅ **User Context**: Logs who performed the assignment
- ✅ **Resource Tracking**: Links assignment to specific escalation and order

## Permission Requirements

### Required Permission
- `escalations:assign` - Permission to manually assign escalations

### Role-Based Access
- **System Administrators**: Can assign to anyone
- **Operations Managers**: Can assign to team members and ICs
- **Individual Contributors**: Can self-assign unassigned escalations

## Error Scenarios

| Error | Status | Description |
|-------|--------|-------------|
| Missing Fields | 400 | `assignedTo` and `assignedToName` required |
| Escalation Not Found | 404 | Escalation ID doesn't exist |
| User Not Found | 400 | Assigned user doesn't exist or inactive |
| No Permissions | 400 | User lacks escalation permissions |
| Over Capacity | 400 | User has reached assignment limit |
| Update Failed | 500 | Database update operation failed |

## Frontend Integration

### Assignment Request
```javascript
const assignEscalation = async (escalationId, assignedTo, assignedToName) => {
  try {
    const response = await axios.post(
      `/escalation/${escalationId}/assign`,
      {
        assignedTo,
        assignedToName
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return response.data;
  } catch (error) {
    console.error('Assignment failed:', error.response?.data);
    throw error;
  }
};
```

### Usage Example
```javascript
// Assign escalation to Operations Manager
await assignEscalation(
  'escalation123',
  'user456', 
  'Jane Smith'
);

// Response will include updated assignment details
// Notification will be sent to assigned user
// Cache will be invalidated for real-time updates
```

## Testing with Postman

### Request Setup
1. **Method**: POST
2. **URL**: `http://localhost:3003/escalation/{escalationId}/assign`
3. **Headers**:
   - `Authorization: Bearer YOUR_TOKEN`
   - `Content-Type: application/json`
4. **Body**:
```json
{
  "assignedTo": "user123",
  "assignedToName": "John Doe"
}
```

### Test Scenarios
1. **Valid Assignment**: Use existing escalation ID and valid user
2. **Invalid User**: Use non-existent user ID
3. **Permission Denied**: Use user without escalation permissions
4. **Over Capacity**: Assign to user with max assignments
5. **Missing Fields**: Send request without required fields

## Auto-Assignment vs Manual Assignment

### Auto-Assignment (Backend Logic)
- **Escalation Rules**: Based on order type, priority, time thresholds
- **Role-Based Routing**: Level 1 → IC, Level 2 → OM, Level 3 → Admin
- **Load Balancing**: Distribute among available team members
- **Skills Matching**: Assign based on expertise/service type

### Manual Assignment (UI Logic)
- **Override Auto-Assignment**: When auto-assignment fails
- **Reassignment**: Move from one person to another
- **Emergency Assignment**: For critical escalations
- **Manager Override**: Operations Manager can reassign team escalations

## Assignment Visibility

### Who Can See What
1. **System Administrators**: All escalations (assigned and unassigned)
2. **Operations Managers**: Team escalations + unassigned in domain
3. **Individual Contributors**: Assigned escalations + unassigned they can take

### Assignment States
- **Unassigned**: `escalated_to = NULL`
- **Assigned**: `escalated_to = user_id`
- **In Progress**: `status = 'in_progress'`
- **Resolved**: `status = 'resolved'`
