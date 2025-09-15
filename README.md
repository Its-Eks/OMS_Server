## OMS Server (Main API) + Onboarding Service Integration

### What this is
- OMS_Server (port 3003): Handles authentication, customer listing/management, stats.
- onboarding-service (port 3004): Handles customer creation and onboarding workflows.
- Hybrid flow: Create customers through onboarding-service; list/manage customers through OMS_Server.

### Prerequisites
- Node.js 18+
- PostgreSQL (shared by both services)
- Optional: Redis, MongoDB for onboarding-service features

### Environment Setup
Set these before starting each service (same database for both):

- OMS_Server
  - `POSTGRES_HOST`
  - `POSTGRES_USER`
  - `POSTGRES_PASSWORD`
  - `POSTGRES_DB`
  - `POSTGRES_PORT=5432`
  - `POSTGRES_SSL=true` (if using cloud DB)
  - `ONBOARDING_SERVICE_URL=http://localhost:3004`
  - Optional: `ONBOARDING_CUSTOMER_CREATE_PATH=/api/onboarding/customers`

- onboarding-service
  - `DATABASE_URL=postgresql://USER:PASS@HOST:5432/DB`
  - `POSTGRES_SSL=true` (if using cloud DB)
  - Optional: `REDIS_URL`, `MONGODB_URI`

PowerShell example (adjust credentials):

```powershell
# onboarding-service
dcd C:\Users\thork\Xnext\OMS\onboarding-service
$env:DATABASE_URL="postgresql://USER:PASS@HOST:5432/DB"
$env:POSTGRES_SSL="true"
npm run dev

# OMS_Server
cd C:\Users\thork\Xnext\OMS\OMS_Server
$env:POSTGRES_HOST="HOST"
$env:POSTGRES_USER="USER"
$env:POSTGRES_PASSWORD="PASS"
$env:POSTGRES_DB="DB"
$env:POSTGRES_PORT="5432"
$env:POSTGRES_SSL="true"
$env:ONBOARDING_SERVICE_URL="http://localhost:3004"
npm run dev
```

### Key Endpoints (OMS_Server)
Base: `http://localhost:3003` (Bearer auth required)

- Customers
  - `POST /customers` → Proxies to onboarding-service to create customer (accepts camelCase or snake_case)
  - `GET /customers` → Lists customers from PostgreSQL
  - `GET /customers/:id` → Get customer by ID (PostgreSQL)
  - `GET /customers/email/:email` → Get customer by email (URL-encode; DB-first, onboarding fallback)
  - `GET /customers/trial` → Trial customers (DB-first, onboarding fallback)
  - `POST /customers/:id/convert-trial` → Convert trial to regular (DB)
  - `GET /customers/stats` → Stats (DB-first, onboarding fallback)
  - `GET /customers/health/services` → Hybrid health check

- Auth
  - `POST /auth/login` → Body: `{ "method": "email", "email": "...", "password": "..." }`

### Key Endpoints (onboarding-service)
Base: `http://localhost:3004`

- Health
  - `GET /health`
- Customers
  - `POST /api/onboarding/customers` → Creates customer in PostgreSQL; falls back to in-memory if DB not connected
  - `GET /api/onboarding/customers` → Lists in-memory customers (used as fallback by OMS_Server)
- Onboarding
  - `POST /api/onboarding/initiate`
  - `GET /api/onboarding/:id`
  - `GET /api/onboarding/customer/:customerId`
  - `PUT /api/onboarding/:id/step/:stepId`
  - `GET /api/onboarding/:id/steps`
  - `GET /api/onboarding/trial-customers`
  - `POST /api/onboarding/trials/:id/convert`

### Data Flow
- Create Customer
  1) Client → OMS_Server `POST /customers`
  2) OMS_Server proxies → onboarding-service `POST /api/onboarding/customers`
  3) onboarding-service inserts into PostgreSQL (if connected) and returns created row
  4) OMS_Server returns created customer to client

- List/Stats
  - OMS_Server reads from PostgreSQL
  - If DB unavailable/empty for certain endpoints, OMS_Server falls back to onboarding-service listing for approximate data

### Request Body (Create Customer)
Accepts camelCase or snake_case:

```json
{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john.doe@example.com",
  "phone": "+1234567890",
  "address": {
    "street": "123 Main St",
    "city": "New York",
    "state": "NY",
    "postalCode": "10001",
    "country": "USA"
  },
  "customerType": "individual",
  "isTrial": false
}
```

### Typical Test Sequence
1) Login and get token
```powershell
curl -s -X POST http://localhost:3003/auth/login -H "Content-Type: application/json" -d '{"method":"email","email":"YOUR_EMAIL","password":"YOUR_PASSWORD"}'
```
2) Create customer
```powershell
curl -s -X POST http://localhost:3003/customers -H "Content-Type: application/json" -H "Authorization: Bearer YOUR_TOKEN" -d '{"firstName":"Jane","lastName":"Smith","email":"jane.smith@company.com","phone":"+1987654321","address":{"street":"456 Business Ave","city":"Los Angeles","state":"CA","postalCode":"90210","country":"USA"},"customerType":"business","isTrial":true}'
```
3) List customers (DB)
```powershell
curl -s -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3003/customers
```
4) Trial customers (DB-first/fallback)
```powershell
curl -s -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3003/customers/trial
```
5) Stats (DB-first/fallback)
```powershell
curl -s -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3003/customers/stats
```
6) Get by email (URL-encoded)
```powershell
curl -s -H "Authorization: Bearer YOUR_TOKEN" "http://localhost:3003/customers/email/jane.smith%40company.com"
```
7) Convert trial to regular
```powershell
curl -s -X POST -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3003/customers/{id}/convert-trial
```

### Troubleshooting
- 404 on create: Ensure onboarding-service exposes `POST /api/onboarding/customers` or set `ONBOARDING_CUSTOMER_CREATE_PATH`.
- Stats/trial return "Failed to fetch customer": Route order must place `/stats` and `/trial` before `/:id` (already done).
- Empty lists: Ensure both services connect to the same PostgreSQL.
- Email lookups: URL-encode `@` → `%40`.

### Notes
- When onboarding-service DB is down, it stores created customers in-memory so creation doesn’t block. Those won’t appear in `/customers` until DB is connected.
- You can extend fallbacks to other GETs if you prefer consistent behavior during DB outages.
