# Unassigned Escalations Visibility Guide

## 🔍 **Who Can See Unassigned Escalations**

### **System Administrators** 
- ✅ **Can see ALL escalations** (assigned and unassigned)
- **Endpoint**: `/escalation/all`
- **Logic**: `WHERE 1=1` (no restrictions)
- **Permission**: `admin:manage_roles` or `escalations:view`

### **Operations Managers**
- ✅ **Can see their assigned escalations** + **unassigned escalations** + **team escalations**
- **Endpoints**: 
  - `/escalation/my-escalations` (their own + unassigned + team)
  - `/escalation/my-team` (team escalations + unassigned)
- **Logic**: `WHERE (e.escalated_to = $1 OR e.escalated_to IS NULL OR e.escalated_to IN (SELECT id FROM users WHERE reporting_manager_id = $1))`
- **Permission**: `escalations:view`

### **Individual Contributors**
- ✅ **Can see their assigned escalations** + **unassigned escalations they can take**
- **Endpoint**: `/escalation/my-escalations`
- **Logic**: `WHERE (e.escalated_to = $1 OR e.escalated_to IS NULL)`
- **Permission**: `escalations:view`

## 📊 **Unassigned Escalations Logic**

### **What Makes an Escalation "Unassigned"**
- **Database Field**: `escalated_to = NULL`
- **Status**: Usually `status = 'open'`
- **Assignment**: No one is currently assigned to handle it

### **Why Unassigned Escalations Exist**
1. **Auto-Assignment Failed**: Backend couldn't find suitable assignee
2. **Manual Assignment Pending**: Waiting for manual assignment
3. **Role Mismatch**: No suitable role available
4. **System Error**: Assignment logic failed silently

## 🎯 **Assignment Priority**

### **1. Auto-Assignment (Backend)**
- **Escalation Rules**: Based on order type, priority, time thresholds
- **Role-Based Routing**: Level 1 → IC, Level 2 → OM, Level 3 → Admin
- **Load Balancing**: Distribute among available team members
- **Skills Matching**: Assign based on expertise/service type

### **2. Manual Assignment (UI)**
- **Override Auto-Assignment**: When auto-assignment fails
- **Reassignment**: Move from one person to another
- **Emergency Assignment**: For critical escalations
- **Manager Override**: Operations Manager can reassign team escalations

## 🔧 **Current Implementation Status**

### **✅ FIXED: Unassigned Escalations Now Visible**

**Before Fix:**
- ❌ Operations Managers couldn't see unassigned escalations
- ❌ Individual Contributors couldn't see unassigned escalations
- ❌ Only System Administrators could see unassigned escalations

**After Fix:**
- ✅ Operations Managers can see unassigned escalations
- ✅ Individual Contributors can see unassigned escalations
- ✅ System Administrators can see all escalations
- ✅ Team escalations include unassigned escalations

### **Updated SQL Logic**

#### **System Administrators**
```sql
WHERE 1=1  -- All escalations
```

#### **Operations Managers**
```sql
WHERE (e.escalated_to = $1 OR e.escalated_to IS NULL OR e.escalated_to IN (SELECT id FROM users WHERE reporting_manager_id = $1))
```

#### **Individual Contributors**
```sql
WHERE (e.escalated_to = $1 OR e.escalated_to IS NULL)
```

#### **Team Escalations**
```sql
WHERE (e.escalated_to IN (SELECT id FROM users WHERE reporting_manager_id = $1) OR e.escalated_to IS NULL)
```

## 🚀 **Testing Unassigned Escalations**

### **1. Create Unassigned Escalations**
```sql
-- Insert escalation without assigned_to
INSERT INTO escalations (order_id, escalation_level, escalated_from, escalation_reason, status, escalation_type, priority)
VALUES (1, 1, 'user123', 'Test escalation', 'open', 'manual', 'normal');
```

### **2. Test Visibility**
- **System Admin**: Should see all escalations including unassigned
- **Operations Manager**: Should see unassigned escalations in their view
- **Individual Contributor**: Should see unassigned escalations they can take

### **3. Test Assignment**
- **Manual Assignment**: Use POST `/escalation/{id}/assign`
- **Auto-Assignment**: Check if backend auto-assigns unassigned escalations
- **Reassignment**: Move escalations between users

## 📋 **Frontend Integration**

### **Display Unassigned Escalations**
```javascript
// Check for unassigned escalations
const unassignedEscalations = escalations.filter(e => !e.escalated_to);

// Show assignment button for unassigned escalations
{unassignedEscalations.map(escalation => (
  <div key={escalation.id}>
    <h3>Unassigned Escalation</h3>
    <button onClick={() => assignEscalation(escalation.id)}>
      Assign to Me
    </button>
  </div>
))}
```

### **Assignment Logic**
```javascript
const assignEscalation = async (escalationId) => {
  try {
    const response = await axios.post(
      `/escalation/${escalationId}/assign`,
      {
        assignedTo: currentUserId,
        assignedToName: currentUserName
      }
    );
    
    // Refresh escalations list
    await fetchEscalations();
  } catch (error) {
    console.error('Assignment failed:', error);
  }
};
```

## 🎯 **Next Steps**

1. **Test the Fix**: Verify unassigned escalations are now visible
2. **Create Test Data**: Insert some unassigned escalations for testing
3. **Frontend Updates**: Update UI to show unassigned escalations
4. **Assignment Testing**: Test manual assignment of unassigned escalations
5. **Auto-Assignment**: Verify backend auto-assignment logic works

## 🔍 **Debugging Unassigned Escalations**

### **Check for Unassigned Escalations**
```sql
SELECT COUNT(*) as unassigned_count 
FROM escalations 
WHERE escalated_to IS NULL AND status = 'open';
```

### **Check Assignment Logic**
```sql
SELECT e.*, o.order_number, o.service_type
FROM escalations e
LEFT JOIN orders o ON o.id = e.order_id
WHERE e.escalated_to IS NULL
ORDER BY e.created_at DESC;
```

### **Check User Permissions**
```sql
SELECT u.id, u.first_name, u.last_name, u.role, u.is_active
FROM users u
WHERE u.role IN ('Operations Manager', 'Individual Contributor')
AND u.is_active = true;
```

The unassigned escalations visibility issue has been **FIXED**! All roles can now see unassigned escalations according to their permissions and responsibilities.
