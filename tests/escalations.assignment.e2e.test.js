/*
 E2E tests for escalation assignment eligibility and reassignment rules.
 Requirements:
 - BACKEND_URL env (default http://localhost:3003)
 - ADMIN_TOKEN env (Bearer token with rights to assign escalations)
 - TEST_ESCALATION_ID env (an existing escalation id to reassign during tests)
 - SYSADMIN_USER_ID env (a known System Administrator user id)
 - OPS_MANAGER_USER_ID env (a known Operations Manager user id)

 Usage:
   BACKEND_URL=http://localhost:3003 \
   ADMIN_TOKEN=eyJ... \
   TEST_ESCALATION_ID=00000000-0000-0000-0000-000000000000 \
   SYSADMIN_USER_ID=90158339-aaed-4cd5-be5d-5c7994e2be04 \
   OPS_MANAGER_USER_ID=addc7571-a00d-4468-a30e-a0740c9c513c \
   node tests/escalations.assignment.e2e.test.js
*/

const BASE_URL = process.env.BACKEND_URL || 'http://localhost:3003';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI5MDE1ODMzOS1hYWVkLTRjZDUtYmU1ZC01Yzc5OTRlMmJlMDQiLCJlbWFpbCI6ImptYXNob2FuYUB4bmV4dC5jby56YSIsInJvbGUiOiJTeXN0ZW0gQWRtaW5pc3RyYXRvciIsInBlcm1pc3Npb25zIjpbImFkbWluOm1hbmFnZV91c2VycyIsImFkbWluOm1hbmFnZV9yb2xlcyIsImFkbWluOnN5c3RlbV9jb25maWciLCJhZG1pbjp2aWV3X2F1ZGl0X2xvZ3MiLCJhZG1pbjpzeXN0ZW1fbW9uaXRvcmluZyIsIm9yZGVyczpyZWFkIiwiY3VzdG9tZXJzOnJlYWQiLCJkYXNoYm9hcmQ6cmVhZCIsIm9yZGVyczpjcmVhdGUiLCJvcmRlcnM6cmVhZCIsIm9yZGVyczp1cGRhdGUiLCJvcmRlcnM6ZGVsZXRlIiwib3JkZXJzOmFzc2lnbiIsIm9yZGVyczplc2NhbGF0ZSIsImN1c3RvbWVyczpjcmVhdGUiLCJjdXN0b21lcnM6cmVhZCIsImN1c3RvbWVyczp1cGRhdGUiLCJjdXN0b21lcnM6ZGVsZXRlIiwiZm5vOmNvbmZpZ3VyZSIsImZubzpzdWJtaXRfYXBpIiwiZm5vOnN1Ym1pdF9tYW51YWwiLCJmbm86dmlld19sb2dzIiwiYXBwX2FkbWluOnZpZXdfaW5ib3giLCJhcHBfYWRtaW46cHJvY2Vzc19hcHBsaWNhdGlvbnMiLCJhcHBfYWRtaW46YXNzaWduX2FwcGxpY2F0aW9ucyIsImVzY2FsYXRpb25zOnZpZXciLCJlc2NhbGF0aW9uczpyZXNvbHZlIiwiZXNjYWxhdGlvbnM6ZXNjYWxhdGUiLCJvbmJvYXJkaW5nOmluaXRpYXRlIiwib25ib2FyZGluZzptYW5hZ2UiLCJvbmJvYXJkaW5nOnZpZXdfdHJpYWxzIiwib25ib2FyZGluZzptYW5hZ2VfY2FtcGFpZ25zIiwiYWRtaW46bWFuYWdlX3VzZXJzIiwiYWRtaW46bWFuYWdlX3JvbGVzIiwiYWRtaW46c3lzdGVtX2NvbmZpZyIsImFkbWluOnZpZXdfYXVkaXRfbG9ncyIsImFkbWluOnN5c3RlbV9tb25pdG9yaW5nIiwiZGFzaGJvYXJkOnJlYWQiXSwidG9rZW5UeXBlIjoiYWNjZXNzIiwiaWF0IjoxNzU5NDc0NjkyLCJleHAiOjE3NTk1NjEwOTIsImF1ZCI6ImlzcC1vbXMtdXNlcnMiLCJpc3MiOiJpc3Atb21zIn0.htlAZ-JKqE9dzeCsig-Wgkf1qI3cyFZqYI8WPses8lU';
const TEST_ESCALATION_ID = process.env.TEST_ESCALATION_ID || '';
const SYSADMIN_USER_ID = process.env.SYSADMIN_USER_ID || '90158339-aaed-4cd5-be5d-5c7994e2be04';
const OPS_MANAGER_USER_ID = process.env.OPS_MANAGER_USER_ID || 'addc7571-a00d-4468-a30e-a0740c9c513c';

async function http(method, path, body, token = ADMIN_TOKEN) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, body: json };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

async function pickEscalationId() {
  // Prefer provided env id
  if (TEST_ESCALATION_ID) return TEST_ESCALATION_ID;
  // Try admin/all list
  const r = await http('GET', '/escalation/all');
  if (r.status === 200 && Array.isArray(r.body?.data) && r.body.data.length) {
    return String(r.body.data[0].id || r.body.data[0].escalation_id || '');
  }
  // Try my-escalations as fallback
  const r2 = await http('GET', '/escalation/my-escalations');
  if (r2.status === 200 && Array.isArray(r2.body?.data) && r2.body.data.length) {
    return String(r2.body.data[0].id || r2.body.data[0].escalation_id || '');
  }
  return '';
}

async function run() {
  console.log('Running Escalation Assignment E2E Tests...');
  assert(ADMIN_TOKEN, 'ADMIN_TOKEN is required');
  assert(SYSADMIN_USER_ID, 'SYSADMIN_USER_ID is required');
  assert(OPS_MANAGER_USER_ID, 'OPS_MANAGER_USER_ID is required');

  const escalationId = await pickEscalationId();
  assert(escalationId, 'Could not find an escalation id. Provide TEST_ESCALATION_ID or ensure there are escalations.');

  // 1) Assign to System Administrator -> expect auto-redirect to eligible user
  console.log('\n[1] Assigning to System Administrator (should be auto-reassigned)');
  const r1 = await http(
    'POST',
    `/escalation/${encodeURIComponent(escalationId)}/assign`,
    { assignedTo: SYSADMIN_USER_ID, assignedToName: 'SysAdmin User' }
  );
  console.log('→ status:', r1.status, 'body:', JSON.stringify(r1.body));
  assert(r1.status === 200, 'Expected 200 for reassignment flow');
  assert(r1.body?.success === true, 'Expected success true');
  const assignedToAfter = r1.body?.data?.assigned_to;
  assert(assignedToAfter && assignedToAfter !== SYSADMIN_USER_ID, 'Expected reassigned away from System Administrator');

  // 2) Assign to Operations Manager -> expect success and assigned_to equals requested id
  console.log('\n[2] Assigning to Operations Manager (should succeed)');
  const r2 = await http(
    'POST',
    `/escalation/${encodeURIComponent(escalationId)}/assign`,
    { assignedTo: OPS_MANAGER_USER_ID, assignedToName: 'Ops Manager' }
  );
  console.log('→ status:', r2.status, 'body:', JSON.stringify(r2.body));
  assert(r2.status === 200, 'Expected 200 for ops manager assignment');
  assert(r2.body?.data?.assigned_to === OPS_MANAGER_USER_ID, 'Expected assigned_to to match OPS_MANAGER_USER_ID');

  console.log('\n✅ All escalation assignment tests passed');
}

run().catch((err) => {
  console.error('\n❌ Test run failed:', err.message);
  process.exit(1);
});


