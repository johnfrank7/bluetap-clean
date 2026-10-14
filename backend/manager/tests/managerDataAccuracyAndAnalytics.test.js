const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const root = resolve(__dirname, '../../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const dashboardCode = read('app/manager/dashboard.jsx');
const analyticsCode = read('app/manager/analytics.jsx');
const accountsCode = read('app/manager/accounts.jsx');
const profileCode = read('app/manager/profile.jsx');
const realtimeCode = read('components/ManagerRealtimeData.jsx');
const shellCode = read('components/ManagerShell.jsx');
const { extractBranchRequesters } = require('../../../services/managerOperational');
const { safeOrder } = require('../workspaceHandler');

test('extractBranchRequesters extracts unique requesters with snapshots and avoids duplicates', () => {
  const users = [
    { id: 'mgr-1', role: 'manager', fullName: 'Manager One' },
    { id: 'dist-1', role: 'distributor', fullName: 'Distributor One' },
    { id: 'req-1', role: 'requester', fullName: 'Alice Requester', phone: '09171234567', barangay: 'San Jose', publicUid: 'Req-101' },
  ];
  const requests = [
    {
      id: 'ord-1',
      requesterUid: 'req-1',
      requesterNameSnapshot: 'Alice Updated',
      contactNumberSnapshot: '09171234567',
      addressSnapshot: '123 Main St',
      barangay: 'San Jose',
      requesterUniqueIdSnapshot: 'Req-101',
    },
    {
      id: 'ord-2',
      requesterUid: 'req-2',
      requesterNameSnapshot: 'Bob Requester',
      contactNumberSnapshot: '09187654321',
      addressSnapshot: '456 Oak Ave',
      barangay: 'Downtown',
      requesterUniqueIdSnapshot: 'Req-102',
    },
    {
      id: 'ord-3',
      userId: 'req-3',
      requester_name: 'Charlie Requester',
      contact_number: '09191112233',
      address: '789 Pine Rd',
      barangay: 'North',
      uniqueId: 'Req-103',
    },
    // Duplicate order for req-2
    {
      id: 'ord-4',
      requester_id: 'req-2',
      requesterNameSnapshot: 'Bob Requester',
    },
  ];

  const requesters = extractBranchRequesters(requests, users);
  assert.equal(requesters.length, 3, 'Should deduplicate across orders and users');
  const ids = requesters.map((r) => r.id);
  assert.ok(ids.includes('req-1'));
  assert.ok(ids.includes('req-2'));
  assert.ok(ids.includes('req-3'));
  assert.ok(!ids.includes('mgr-1'), 'Manager must never be included in requesters');
  assert.ok(!ids.includes('dist-1'), 'Distributor must never be included in requesters');
});

test('safeOrder extracts requesterUid across alternative order field aliases', () => {
  const order1 = safeOrder('o1', { requesterUid: 'u1', requesterNameSnapshot: 'Name 1' });
  assert.equal(order1.requesterUid, 'u1');

  const order2 = safeOrder('o2', { requester_id: 'u2', requester_name: 'Name 2' });
  assert.equal(order2.requesterUid, 'u2');

  const order3 = safeOrder('o3', { userId: 'u3', address: 'Addr 3' });
  assert.equal(order3.requesterUid, 'u3');

  const order4 = safeOrder('o4', { user_id: 'u4', deliveryAddress: 'Addr 4' });
  assert.equal(order4.requesterUid, 'u4');
});

test('Manager Dashboard calculates registeredUsers as sum of distributors and branch requesters without counting Manager', () => {
  assert.match(dashboardCode, /extractBranchRequesters/);
  assert.match(dashboardCode, /registeredUsers = registeredDistributorCount \+ registeredRequesterCount/);
  assert.match(dashboardCode, /registeredDistributors: registeredDistributorCount/);
  assert.match(dashboardCode, /registeredRequesters: registeredRequesterCount/);
  assert.doesNotMatch(dashboardCode, /\+18 this month/, 'Fake metric +18 this month must be removed');
  assert.match(dashboardCode, /helper="Distributors & branch requesters"/);
});

test('Manager Analytics UI has uniform KPI cards, responsive layout, and accurate branch people count', () => {
  assert.match(analyticsCode, /minHeight:\s*126/);
  assert.match(analyticsCode, /padding:\s*16/);
  assert.match(analyticsCode, /Ordered from this branch/);
  assert.match(analyticsCode, /Assigned to branch/);
  assert.match(analyticsCode, /extractBranchRequesters/);
  assert.match(analyticsCode, /Order status distribution/);
  assert.match(analyticsCode, /Branch people/);
  assert.match(analyticsCode, /Delivered product breakdown/);
  assert.match(analyticsCode, /BRANCH-ONLY SCOPE/);
});

test('Manager Accounts UI merges branch requesters for view-only branch visibility', () => {
  assert.match(accountsCode, /useManagerRealtimeData/);
  assert.match(accountsCode, /workspace\?\.requesters/);
  assert.match(accountsCode, /realtime\?\.requesters/);
  assert.match(accountsCode, /label="Requesters"/);
  assert.match(accountsCode, /label="Distributors"/);
});

test('Manager Profile supports image size validation, web photo conversion, and navbar instant sync', () => {
  assert.match(profileCode, /3 \* 1024 \* 1024/);
  assert.match(profileCode, /Profile pictures must be 3 MB or smaller/);
  assert.match(profileCode, /updateManagerProfile\(\{ fullName, phone, address \}, selectedImage\)/);
  assert.match(profileCode, /realtime\.primeProfile\(saved\)/);
  assert.match(profileCode, /saveLocalUser\(saved\)/);
  assert.match(realtimeCode, /profile:\s*state\.profile \|\| session\.profile/);
  assert.match(shellCode, /managerProfile\.fullName/);
  assert.match(shellCode, /managerProfile\.profilePhotoUrl/);
});
