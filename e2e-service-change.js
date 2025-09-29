/*
 End-to-end verifier for service_change workflow and onboarding sync

 Usage:
   BASE_URL=http://localhost:3003 TOKEN=ey... node scripts/e2e-service-change.js
*/

/* eslint-disable no-console */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3003'
const TOKEN = process.env.TOKEN

if (!TOKEN) {
  console.error('Missing TOKEN env. Set TOKEN=<JWT>')
  process.exit(2)
}

const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${TOKEN}`
}

async function http(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  })
  let data = null
  try {
    data = await res.json()
  } catch (_) {
    // ignore
  }
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || res.statusText
    throw new Error(`${method} ${path} failed: ${res.status} ${msg}`)
  }
  return data
}

async function getWorkflowState(orderId) {
  return await http('GET', `/orders/${orderId}/workflow-state`)
}

async function postStatus(orderId, status, reason) {
  return await http('POST', `/orders/${orderId}/status`, { status, reason })
}

async function createServiceChangeOrder() {
  const payload = {
    customerId: '7308d209-a5be-49a9-8692-26abe87f7c8b',
    orderType: 'service_change',
    priority: 'normal',
    details: { requestedChange: 'Upgrade to 1Gbps', reason: 'Bandwidth increase' }
  }
  const created = await http('POST', '/orders', payload)
  const order = created?.data || created
  if (!order?.id) throw new Error('Order create returned no id')
  return order.id
}

async function getOnboardingByOrder(orderId) {
  const act = await http('GET', '/onboarding/active')
  const list = act?.data || []
  return list.find(x => String(x.order_id || x.orderId) === String(orderId)) || null
}

async function getOnboardingDetails(onboardingId) {
  return await http('GET', `/onboarding/${onboardingId}`)
}

function expectEq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${expected} but got ${actual}`)
  }
}

async function main() {
  console.log(`[e2e] Using BASE_URL=${BASE_URL}`)

  // 1) Create order
  const orderId = await createServiceChangeOrder()
  console.log(`[e2e] Created service_change order: ${orderId}`)

  // Ensure workflow is initialized
  const s0 = await getWorkflowState(orderId)
  console.log('[e2e] Initial workflow state:', s0)
  expectEq(s0?.state, 'created', 'Initial workflow state')

  // Ensure onboarding exists
  const ob0 = await getOnboardingByOrder(orderId)
  if (!ob0) throw new Error('Onboarding not found for order after creation')
  console.log(`[e2e] Onboarding found: ${ob0.id}`)

  // Mapping: service_change -> onboarding current_step
  const mapServiceChange = {
    validated: 'initiated',
    change_scheduled: 'service_configuration',
    in_progress: 'provisioning_in_flight',
    changed: 'service_activated',
    activated: 'service_activated',
    completed: 'completed'
  }

  const steps = [
    { to: 'validated', reason: 'QA passed' },
    { to: 'change_scheduled', reason: 'Scheduled' },
    { to: 'in_progress', reason: 'Engineer started' },
    { to: 'changed', reason: 'Change applied' },
    { to: 'activated', reason: 'Service re-activated' },
    { to: 'completed', reason: 'All checks passed' }
  ]

  for (const step of steps) {
    console.log(`[e2e] Transition -> ${step.to}`)
    await postStatus(orderId, step.to, step.reason)
    const st = await getWorkflowState(orderId)
    console.log('[e2e] Workflow state after transition:', st)
    expectEq(st?.state, step.to, 'Workflow state')

    // Verify onboarding current_step sync
    const ob = await getOnboardingByOrder(orderId)
    if (!ob) throw new Error('Onboarding vanished from active list')
    const obDet = await getOnboardingDetails(ob.id)
    const currentStep = (obDet?.data?.current_step || obDet?.current_step || '').toString()
    const expectedStep = mapServiceChange[step.to]
    if (expectedStep) {
      expectEq(currentStep, expectedStep, 'Onboarding current_step')
    }
  }

  console.log('[e2e] All transitions verified successfully for service_change.')
}

// Node 18+ has fetch globally
main().catch(err => {
  console.error('[e2e] FAILED:', err?.message || err)
  process.exit(1)
})


