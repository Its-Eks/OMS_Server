## Order Workflow Guide

### Overview

This guide documents the OMS order workflow aligned to the PRD: lifecycle states, validation rules, APIs, and testing steps. Requests accept both camelCase and snake_case; responses use camelCase.

### Core Endpoints

- POST `/orders` — create order
- GET `/orders/:id` — fetch order
- PUT `/orders/:id` — update order (partial)
- PATCH `/orders/:id/status` — transition order status
- GET `/orders/:id/history` — fetch full state history
- GET `/fnos` — list FNOs

### Lifecycle (PRD-aligned)

created → validated → enriched → fno_submitted → fno_accepted → installation_scheduled → in_progress → installed → activated → completed

- Cancellation is supported as a separate flow.
- Every change is recorded in `order_state_history`.

### Server-Side Validation Rules

- Invalid transitions return 400 with a clear message.
- validated: performs basic checks (address, service availability, credit). Missing required fields → 422.
- enriched: requires enrichment data (e.g., network params) to be present.
- fno_submitted: requires `fnoId` to be set; strictly enforced.
- Transitions are resolved via the Configurable Workflow Service; legacy workflow map is used as a fallback.

### FNO Requirements

Before transitioning to `fno_submitted`:

1) GET `/fnos` → pick an active FNO `id`.
2) PUT `/orders/:id` with `{ "fnoId": "<uuid>" }`.

Attempting `fno_submitted` without `fnoId` returns 400.

### Request Body Casing

- Input accepts camelCase or snake_case (middleware normalizes).
- DB uses snake_case; API responses are normalized to camelCase.

### History

- Initial creation and each transition recorded in `order_state_history`.
- GET `/orders/:id/history` returns an ordered timeline (includes workflow execution history where applicable).

---

## Postman Test Flow

Prereqs: Valid JWT with order permissions; optionally seed FNOs.

1) Create Order

POST http://localhost:3003/orders

Body:

```
{
  "customerId": "<customer_uuid>",
  "orderType": "new_install",
  "priority": "medium",
  "serviceAddress": {
    "street": "123 Rivonia Road",
    "city": "Johannesburg",
    "province": "Gauteng",
    "postalCode": "2196",
    "country": "South Africa"
  },
  "serviceDetails": {
    "serviceType": "internet",
    "bandwidth": "100/100",
    "installationType": "professional_install"
  }
}
```

Expect: 201 with order payload (`status: created`).

2) Validate

PATCH http://localhost:3003/orders/{orderId}/status

Body:

```
{ "status": "validated" }
```

Expect: 200; history includes `validated`.

3) Enrich

PUT http://localhost:3003/orders/{orderId}

Body (example):

```
{ "serviceDetails": { "networkParams": { "vlan": 123 } } }
```

Then: PATCH status → `enriched`.

4) Set FNO and Submit

- GET http://localhost:3003/fnos → choose `id`.
- PUT http://localhost:3003/orders/{orderId}

Body:

```
{ "fnoId": "<fno_uuid>" }
```

- PATCH http://localhost:3003/orders/{orderId}/status

Body:

```
{ "status": "fno_submitted" }
```

If `fnoId` missing → 400 “FNO not determined for order”.

5) Progress to Completion

Sequential PATCH bodies:

```
{ "status": "fno_accepted" }
{ "status": "installation_scheduled" }
{ "status": "in_progress" }
{ "status": "installed" }
{ "status": "activated" }
{ "status": "completed" }
```

6) Fetch Order and History

- GET http://localhost:3003/orders/{orderId}
- GET http://localhost:3003/orders/{orderId}/history

---

## Troubleshooting

- 400 Invalid transition: Ensure previous state matches lifecycle; follow step order.
- 400 FNO required: Set `fnoId` on the order before `fno_submitted`.
- 422 Validation failure on validated: Provide full address/service details.
- 404 Order not found: Verify `orderId` and environment.

---

## Notes for Developers

- Imports are ESM with explicit `.ts` and correct case-sensitive paths.
- Configurable workflow (DB-backed) is integrated; legacy workflow engine remains as fallback for resilience.
- Every state change is persisted to `order_state_history` to satisfy audit requirements.


