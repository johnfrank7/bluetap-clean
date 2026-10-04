const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const babel = require('@babel/core');
const { createRequire } = require('node:module');

function requireTranspiled(relPath) {
  const fullPath = path.resolve(__dirname, relPath);
  const code = fs.readFileSync(fullPath, 'utf8');
  const transformed = babel.transformSync(code, {
    presets: ['babel-preset-expo'],
    filename: fullPath,
  }).code;
  const mod = { exports: {} };
  const customRequire = createRequire(fullPath);
  const fn = new Function('require', 'module', 'exports', transformed);
  fn(customRequire, mod, mod.exports);
  return mod.exports;
}

const {
  buildSafeAssistantContext,
  sanitizeOrder,
  sanitizeRestriction,
  sanitizeNotification,
} = requireTranspiled('../../../services/assistant/assistantContext.js');

const {
  ASSISTANT_ACTIONS,
  executeAssistantAction,
  createAction,
} = requireTranspiled('../../../services/assistant/assistantActions.js');

test('sanitizeOrder strips confidential, internal, and sensitive database fields', () => {
  const dirtyOrder = {
    id: 'ord_999',
    publicOrderId: 'ORD-999',
    status: 'pending',
    branch_name: 'Main Hub',
    internalNotes: 'Flagged for inspection by dispatcher',
    adminNotes: 'High risk address',
    distributorPrivateNote: 'Do not ring bell',
    token: 'jwt_secret_token_abc',
    password: 'supersecretpassword',
    secretKey: 'sk_live_12345',
    sessionHash: 'hash_xyz',
    internalAuditId: 'audit_001',
    distributorUid: 'dis_actual_firebase_auth_uid',
    reporterUid: 'rep_123',
    quantity: 3,
    total_amount: 150,
  };

  const safe = sanitizeOrder(dirtyOrder);

  // Assert essential public fields preserved
  assert.equal(safe.id, 'ord_999');
  assert.equal(safe.publicOrderId, 'ORD-999');
  assert.equal(safe.status, 'pending');
  assert.equal(safe.branchName, 'Main Hub');

  // Assert all confidential/internal fields stripped
  assert.equal(safe.internalNotes, undefined);
  assert.equal(safe.adminNotes, undefined);
  assert.equal(safe.distributorPrivateNote, undefined);
  assert.equal(safe.token, undefined);
  assert.equal(safe.password, undefined);
  assert.equal(safe.secretKey, undefined);
  assert.equal(safe.sessionHash, undefined);
  assert.equal(safe.internalAuditId, undefined);
  assert.equal(safe.distributorUid, undefined);
  assert.equal(safe.reporterUid, undefined);
});

test('sanitizeRestriction strips reporter identity and private moderator notes', () => {
  const dirtyRestriction = {
    id: 'rest_01',
    scope: ['ordering'],
    branch_id: 'branch_a',
    branch_name: 'Branch A',
    category: 'repeated_cancellations',
    reporterUid: 'user_secret_uid_123',
    reportedBy: 'Manager Dave',
    reporterEmail: 'dave@water.com',
    moderatorPrivateNotes: 'User was aggressive on phone call',
    internalSeverityScore: 9,
    ends_at: 1720000000000,
  };

  const safe = sanitizeRestriction(dirtyRestriction);

  // Assert safe customer-facing fields present
  assert.equal(safe.id, 'rest_01');
  assert.deepEqual(safe.scope, ['ordering']);
  assert.equal(safe.branchName, 'Branch A');
  assert.equal(safe.category, 'repeated cancellations');

  // Assert reporter/internal fields stripped
  assert.equal(safe.reporterUid, undefined);
  assert.equal(safe.reportedBy, undefined);
  assert.equal(safe.reporterEmail, undefined);
  assert.equal(safe.moderatorPrivateNotes, undefined);
  assert.equal(safe.internalSeverityScore, undefined);
});

test('sanitizeNotification preserves only user-safe notification content', () => {
  const dirtyNotification = {
    id: 'notif_01',
    type: 'order_status',
    title: 'Order Dispatched',
    body: 'Your water is on the way!',
    meta: {
      serverIp: '192.168.1.1',
      dispatcherUid: 'mgr_007',
      internalTraceId: 'trace_abc_123',
    },
    created_at: 1710000000000,
  };

  const safe = sanitizeNotification(dirtyNotification);

  assert.equal(safe.id, 'notif_01');
  assert.equal(safe.title, 'Order Dispatched');
  assert.equal(safe.message, 'Your water is on the way!');
  assert.equal(safe.meta, undefined);
  assert.equal(safe.serverIp, undefined);
  assert.equal(safe.dispatcherUid, undefined);
});

test('executeAssistantAction safely routes allowed actions and rejects unknowns', async () => {
  const routerNavs = [];
  const fakeRouter = {
    push: (url) => routerNavs.push({ method: 'push', url }),
    replace: (url) => routerNavs.push({ method: 'replace', url }),
  };

  let stationChatBranchId = null;
  const fakeChat = {
    openStationChat: async (branchId) => {
      stationChatBranchId = branchId;
    },
  };

  // Test START_ORDER action
  const startOrderAct = createAction(ASSISTANT_ACTIONS.START_ORDER);
  await executeAssistantAction(startOrderAct, { router: fakeRouter, chat: fakeChat });
  assert.equal(routerNavs[0].url, '/requester/requestform');

  // Test VIEW_ORDER action
  const viewOrderAct = createAction(ASSISTANT_ACTIONS.VIEW_ORDER, { orderId: 'ord_123' });
  await executeAssistantAction(viewOrderAct, { router: fakeRouter, chat: fakeChat });
  assert.ok(routerNavs.some((n) => typeof n.url === 'object' && n.url.pathname === '/requester/r_request'));

  // Test CONTACT_STATION action
  const contactStationAct = createAction(ASSISTANT_ACTIONS.CONTACT_STATION, { branchId: 'branch_dt' });
  await executeAssistantAction(contactStationAct, { router: fakeRouter, chat: fakeChat });
  assert.equal(stationChatBranchId, 'branch_dt');

  // Test malformed / unknown action is rejected
  await assert.rejects(async () => {
    await executeAssistantAction({ type: 'MALICIOUS_INJECTION' }, { router: fakeRouter, chat: fakeChat });
  }, /Cannot execute unknown assistant action type/);
});
