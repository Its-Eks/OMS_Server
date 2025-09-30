# Manual Escalation Assignment Guide

## 🎯 **Two Assignment Methods**

### **1. Automatic Assignment (Default)**
- **Triggers**: When new escalations are created
- **Logic**: Uses escalation rules + load balancing
- **Result**: Automatically assigned to available Operations Manager

### **2. Manual Assignment (Override)**
- **Triggers**: When you want to override automatic assignment
- **Method**: Use the assignment API endpoint
- **Result**: Manually assign to specific Operations Manager

## 🔧 **Manual Assignment API**

### **Endpoint**
```
POST /escalation/{escalationId}/assign
```

### **Request Body**
```json
{
  "assignedTo": "user-id-here",
  "assignedToName": "John Doe"
}
```

### **Response**
```json
{
  "success": true,
  "data": {
    "id": "escalation-id",
    "assigned_to": "user-id-here",
    "assigned_to_name": "John Doe",
    "assigned_at": "2024-01-15T10:30:00Z",
    "status": "in_progress"
  }
}
```

## 📋 **Step-by-Step Manual Assignment**

### **Step 1: Get Escalation ID**
```javascript
// Get unassigned escalations
const response = await fetch('/escalation/my-escalations?status=open', {
  headers: { 'Authorization': `Bearer ${token}` }
});
const data = await response.json();
const unassignedEscalation = data.data.escalations.find(e => !e.escalated_to);
```

### **Step 2: Get Available Operations Managers**
```javascript
// Get Operations Managers
const omResponse = await fetch('/users?role=Operations Manager', {
  headers: { 'Authorization': `Bearer ${token}` }
});
const omData = await omResponse.json();
const availableOMs = omData.data.filter(u => u.is_active);
```

### **Step 3: Assign Escalation**
```javascript
// Assign to specific Operations Manager
const assignResponse = await fetch(`/escalation/${unassignedEscalation.id}/assign`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    assignedTo: availableOMs[0].id,
    assignedToName: availableOMs[0].first_name + ' ' + availableOMs[0].last_name
  })
});

const assignResult = await assignResponse.json();
console.log('Assignment result:', assignResult);
```

## 🎛️ **Frontend UI Example**

### **Assignment Button Component**
```jsx
const AssignmentButton = ({ escalation, onAssign }) => {
  const [availableOMs, setAvailableOMs] = useState([]);
  const [selectedOM, setSelectedOM] = useState('');

  const handleAssign = async () => {
    try {
      const response = await fetch(`/escalation/${escalation.id}/assign`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          assignedTo: selectedOM,
          assignedToName: availableOMs.find(om => om.id === selectedOM)?.name
        })
      });
      
      const result = await response.json();
      if (result.success) {
        onAssign(escalation.id, result.data);
      }
    } catch (error) {
      console.error('Assignment failed:', error);
    }
  };

  return (
    <div>
      <select value={selectedOM} onChange={(e) => setSelectedOM(e.target.value)}>
        <option value="">Select Operations Manager</option>
        {availableOMs.map(om => (
          <option key={om.id} value={om.id}>
            {om.name}
          </option>
        ))}
      </select>
      <button onClick={handleAssign} disabled={!selectedOM}>
        Assign Escalation
      </button>
    </div>
  );
};
```

## 🔄 **Assignment Flow**

### **Automatic Assignment (Default)**
1. **New escalation created** → System checks escalation rules
2. **Finds matching rule** → Assigns to specified role
3. **No matching rule** → Uses fallback with load balancing
4. **Load balancing** → Assigns to Operations Manager with fewest escalations

### **Manual Assignment (Override)**
1. **User selects escalation** → Shows assignment options
2. **User chooses Operations Manager** → Sends assignment request
3. **System validates** → Checks user permissions and availability
4. **Assignment succeeds** → Updates escalation and sends notification

## ⚠️ **Important Notes**

- **Automatic assignment** happens immediately when escalations are created
- **Manual assignment** overrides automatic assignment
- **Load balancing** ensures fair distribution between Operations Managers
- **Notifications** are sent to assigned Operations Manager
- **Audit trail** tracks all assignment changes
