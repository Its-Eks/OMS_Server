# Testing Guide - Dynamic Order Routes & Trial Conversion

## 🚀 Server Status
✅ Server is running on `http://localhost:3003`

## 📍 Test Endpoints

### 1. Health Check (No Auth Required)
```bash
curl http://localhost:3003/health
```

### 2. Dynamic Workflow State
**Test with a regular order:**
```bash
curl -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  http://localhost:3003/orders/28333e83-3feb-46ac-b209-f7bc9153859b/workflow/state
```

**Expected Response:**
```json
{
  "success": true,
  "state": "created",
  "description": "Order created",
  "transitions": [
    { "toState": "validated", "name": "Validate" },
    { "toState": "cancelled", "name": "Cancel" }
  ]
}
```

**Test with a trial order:**
- If `order_type = 'trial'`, it will route to `http://localhost:3004/trials/:id/workflow/state`
- Falls back to local workflow if trial service unavailable

### 3. Dynamic Order History
```bash
curl -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  http://localhost:3003/orders/28333e83-3feb-46ac-b209-f7bc9153859b/history
```

**Expected Response:**
```json
{
  "success": true,
  "data": [
    {
      "timestamp": "2025-10-13T10:00:00Z",
      "event": "Order Created",
      "actor": "John Doe",
      "details": {}
    }
  ]
}
```

### 4. FNO Submission (Real - No Simulation)
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:3003/orders/28333e83-3feb-46ac-b209-f7bc9153859b/fno/submit
```

**What it does:**
1. Validates order is ready for FNO submission
2. Calls real Openserve API
3. Returns submission status
4. Updates order workflow state

### 5. FNO Status Polling
```bash
curl -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  http://localhost:3003/orders/28333e83-3feb-46ac-b209-f7bc9153859b/fno/status
```

### 6. Coverage Check (28East Integration)
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "address": {
      "street": "123 Main Street",
      "city": "Cape Town",
      "postalCode": "8001"
    }
  }' \
  http://localhost:3003/orders/28333e83-3feb-46ac-b209-f7bc9153859b/coverage/check
```

### 7. Trial Conversion
**Get available service packages:**
```bash
curl -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  http://localhost:3003/trials/service-packages
```

**Convert trial to paid:**
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "servicePackageId": "pkg-uuid-here",
    "paymentMethod": "peach_payments",
    "paymentDetails": {
      "cardNumber": "4111111111111111",
      "expiryDate": "12/25",
      "cvv": "123"
    }
  }' \
  http://localhost:3003/trials/TRIAL_ID/convert-to-paid
```

## 🖥️ Frontend Testing

### 1. Order Details Page
**URL:** `http://localhost:5173/orders/28333e83-3feb-46ac-b209-f7bc9153859b`

**What to test:**
- ✅ Order details load
- ✅ Trial Workflow tab shows conversion button (if trial order)
- ✅ FNO submission form has real action buttons:
  - Validate Order
  - Check Coverage
  - Enrich Order Data
  - Submit to FNO
  - Poll FNO Status
- ✅ No simulation buttons present

### 2. Trial Analytics Page
**URL:** `http://localhost:5173/trial-analytics`

**What to test:**
- ✅ Active trials list displays
- ✅ Each trial has "Convert to Paid" button
- ✅ Clicking button opens conversion modal
- ✅ Modal shows:
  - Service package selection
  - Payment method selection
  - Form validation

### 3. Onboarding Page
**URL:** `http://localhost:5173/onboarding`

**What to test:**
- ✅ No "Simulate Provisioning" button present
- ✅ Message directs to Order Details for real provisioning
- ✅ Created orders can be accessed for real FNO actions

## 🧪 End-to-End Trial Flow

### Complete Journey Test:

1. **Create Customer**
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "John",
    "lastName": "Doe",
    "email": "test@example.com",
    "phone": "+27123456789",
    "address": {
      "street": "123 Main St",
      "city": "Cape Town",
      "postalCode": "8001"
    },
    "isTrial": true
  }' \
  http://localhost:3003/customers
```

2. **Create Trial Order**
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "CUSTOMER_ID_FROM_STEP_1",
    "orderType": "trial",
    "serviceType": "Trial",
    "servicePackage": "trial_package"
  }' \
  http://localhost:3003/orders
```

3. **Check Coverage**
Use Order ID from Step 2 → Coverage Check endpoint

4. **Submit to FNO**
Use Order ID from Step 2 → FNO Submit endpoint

5. **Poll FNO Status**
Use Order ID from Step 2 → FNO Status endpoint

6. **Convert to Paid**
Use Trial ID → Convert endpoint with selected package

7. **Verify Email Sent**
Check email inbox for conversion confirmation

## ⚠️ Known Requirements

### API Keys Needed:
- `OPENSERVE_API_KEY` - For FNO submission/status
- `TWENTY_EIGHT_EAST_API_KEY` - For coverage checking
- `PEACH_PAYMENTS_API_KEY` - For payment processing
- `NETCASH_API_KEY` - For debit orders
- `STRIPE_SECRET_KEY` - For Stripe payments

### Without API Keys:
- FNO endpoints will return error messages indicating missing keys
- Coverage checks will return mock/fallback data
- Payment processing will fail gracefully with error messages

## 📊 Expected Behaviors

### Dynamic Routing Logic:
1. **Request received** → `/orders/:id/workflow/state`
2. **Check order type** → Query database for `order_type`
3. **Route decision:**
   - If `order_type = 'trial'` → Proxy to `http://localhost:3004/trials/:id/workflow/state`
   - Else → Use local workflow engine
4. **Fallback:** If trial service unavailable, return safe default

### FNO Integration:
- All simulation removed
- Real API calls with proper error handling
- Status tracking in database
- Email notifications on status changes

### Trial Conversion:
- UI components integrated in Order Details and Trial Analytics
- Payment provider selection
- Service package selection
- Email confirmation on successful conversion
- Customer type automatically upgraded from trial to regular

## 🔍 Debugging

### Check Server Logs:
```bash
cd "OMS Backend"
npm run dev
```

Look for:
- `✓ Routes: Trial routes mounted`
- `✓ HTTP Server: Listening on port 3003`
- `✅ SERVER READY`

### Common Issues:

**1. "No token provided"**
- Solution: Include Firebase auth token in Authorization header

**2. "Order not found"**
- Solution: Verify order ID exists in database

**3. "Trial service unavailable"**
- Solution: Check if TBYB-OMS-MicroService is running on port 3004
- Fallback: System will use local data

**4. "Invalid API key"**
- Solution: Set environment variables for external services

## ✅ Success Indicators

You'll know everything is working when:
- ✅ Server starts without errors
- ✅ All endpoints return proper responses (with auth)
- ✅ Dynamic routing switches based on order type
- ✅ Frontend shows real action buttons (no simulations)
- ✅ Trial conversion modal opens and submits
- ✅ Emails are sent on conversions
- ✅ Database updates reflect workflow changes

---

**Happy Testing! 🎉**

For issues or questions, check:
- `IMPLEMENTATION_COMPLETE.md` - Full feature documentation
- Server logs - Real-time error messages
- Database - Direct data verification

