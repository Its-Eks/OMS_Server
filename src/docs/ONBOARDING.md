## Onboarding through OMS_Server (Gateway)

This document explains how the main server exposes onboarding capabilities by proxying to `onboarding-service`, and how to test them.

### What OMS_Server owns vs proxies
- Owns customer CRUD, queries, stats, and trial conversion under `/customers/*`.
- Proxies selected onboarding endpoints under `/onboarding/*` to the onboarding-service.

### Environment for local proxying
Create `.env` in this directory with:
```
ONBOARDING_SERVICE_URL=http://localhost:3004
ONBOARDING_CUSTOMER_CREATE_PATH=/api/onboarding/customers
```
Restart the server after editing `.env`.

### Proxied endpoints
- `GET /onboarding/active` → `GET /api/onboarding/active`
- `GET /onboarding/:id` → `GET /api/onboarding/:id`
- `PATCH /onboarding/:id/assign` → `PATCH /api/onboarding/:id/assign`
- `POST /onboarding/:id/notify` → `POST /api/onboarding/:id/notify`

Notes:
- Customer creation (`POST /customers`) will call the onboarding-service’s `POST /api/onboarding/customers` under the hood for hybrid-creation, then persist to Postgres.
- Retry/warmup behavior is implemented for 502/503 hosted cold starts when creating customers.

### Test locally (through OMS_Server)
Assuming OMS_Server runs on `http://localhost:3003` and onboarding-service on `http://localhost:3004`.

1) Create customer via gateway (Bearer token required):
```
curl -X POST http://localhost:3003/customers \
  -H "Authorization: Bearer <oms_access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "firstName":"Thandi",
    "lastName":"Nkosi",
    "email":"thandi.nkosi@example.com",
    "phone":"+27-82-123-4567",
    "address":{
      "street":"123 Rivonia Road",
      "city":"Johannesburg",
      "state":"Gauteng",
      "postalCode":"2196",
      "country":"South Africa"
    },
    "customerType":"business",
    "isTrial":true
  }'
```

2) Onboarding proxies:
```
curl http://localhost:3003/onboarding/active
curl http://localhost:3003/onboarding/<id>
curl -X PATCH http://localhost:3003/onboarding/<id>/assign -H "Content-Type: application/json" -d '{"assignedTo":"ops@company.com"}'
curl -X POST http://localhost:3003/onboarding/<id>/notify -H "Content-Type: application/json" -d '{"type":"welcome"}'
```

### Troubleshooting
- 401 from `/customers`: ensure `Authorization: Bearer <oms_access_token>` is included (frontend interceptor does this automatically when the token exists in localStorage).
- 500 on `/customers` with hosted services: often a 502/503 from onboarding-service (cold start). Warm `GET https://microservices-oms.onrender.com/health` then retry; or test locally by pointing `ONBOARDING_SERVICE_URL` to `http://localhost:3004`.
- CORS: server is configured to allow localhost and Render domains. If testing from other origins, add them to CORS config.


