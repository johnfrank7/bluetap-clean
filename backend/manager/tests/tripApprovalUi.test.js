const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');

function loadTripService({ qa = true, connected = true, capability = true, wrongProposal = false, failWrite = false, badCapacity = false, capacityData = null, backendProject = 'demo-bluetap-local-qa' } = {}) {
  const filename = path.resolve(__dirname, '../../../services/tripApprovals.js');
  const code = babel.transformSync(fs.readFileSync(filename, 'utf8'), { plugins: ['@babel/plugin-transform-modules-commonjs'], configFile: false, babelrc: false }).code;
  const projectId = 'demo-bluetap-local-qa'; const auth = { app: { options: { projectId } }, currentUser: { getIdToken: async () => 'synthetic' } }; const db = { app: { options: { projectId } } };
  const config = { apiUrl: 'http://127.0.0.1:3000', authUrl: 'http://127.0.0.1:9099', firestoreHost: '127.0.0.1', firestorePort: 8080, firebase: { projectId } };
  const world = { __bluetapLocalQaAuthConnections: new WeakMap(), __bluetapLocalQaFirestoreConnections: new WeakMap(), crypto: { randomUUID: () => 'request-id-1234' } };
  if (connected) { world.__bluetapLocalQaAuthConnections.set(auth, config.authUrl); world.__bluetapLocalQaFirestoreConnections.set(db, '127.0.0.1:8080'); }
  const calls = []; let response = capability;
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/api/trip-capability')) return { ok: true, json: async () => ({ tripApprovalAvailable: response, emulatorProjectId: backendProject }) };
    if (url.includes('capacityOnly=1') && capacityData) return { ok: true, json: async () => capacityData };
    if (failWrite && init.method !== 'GET') throw new Error('Network failure');
    const submitted = init.body ? JSON.parse(init.body) : {};
    return { ok: true, json: async () => ({ success: !wrongProposal, tripId: submitted.tripId, proposal: { status: 'pending', orderId: wrongProposal ? 'other-order' : submitted.orderId, id: submitted.clientMutationId, scheduledAt: submitted.scheduledAt, tripId: submitted.tripId, distributorUid: submitted.distributorUid, reason: submitted.reason }, order: { id: 'order-1', assignedDistributorUid: submitted.distributorUid }, trips: [], orders: [], eligibleDistributorUids: ['driver'], resources: [{ id: 'opaque-a', available: true }, { id: 'opaque-b', available: false }], distributors: [], selectedTrip: badCapacity ? { tripId: 'other', verified: true, standardContainers: 0 } : null }) };
  };
  const module = { exports: {} }; const react = { useState() {}, useEffect() {} };
  vm.runInNewContext(code, { module, exports: module.exports, globalThis: world, fetch, Error, encodeURIComponent, require: (name) => {
    if (name === 'react') return react;
    if (name === 'firebase/auth') return { onAuthStateChanged() {} };
    if (name === '../firebase') return { auth, db };
    if (name === './stagingConfig') return { resolveLocalQaClient: () => qa ? config : null };
    if (name === './apiClientConfig') return { getApiBaseUrl: () => config.apiUrl, getApiUrl: (route) => `${config.apiUrl}${route}` };
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  return { api: module.exports, calls, setCapability: (value) => { response = value; } };
}

test('capacity reads require a verified emulator capability and reject malformed selected trips', async () => {
  const { api, calls, setCapability } = loadTripService();
  const result = await api.getManagerTripCapacity('trip-1'); assert.equal(result.selectedTrip, null);
  assert.equal(calls.filter((item) => item.url.endsWith('/api/trip-capability')).length, 1);
  assert.match(calls[1].url, /tripPreparation=1&capacityOnly=1&tripId=trip-1/);
  setCapability(false); await assert.rejects(api.getManagerTripCapacity('trip-1'), /unavailable/);
  const invalid = loadTripService({ badCapacity: true }); await assert.rejects(invalid.api.getManagerTripCapacity('trip-1'), /could not be verified/);
  const production = loadTripService({ qa: false }); await assert.rejects(production.api.getManagerTripCapacity('trip-1'), /unavailable/); assert.equal(production.calls.length, 0);
});

test('capacity response accepts only an unambiguous branch-authorized active fallback', async () => {
  const trip = { tripId: 'active-trip', distributorUid: 'driver', state: 'in_transit', verified: true, eligible: true, standardContainers: 45, hasOtherCargo: false, mixedReviewStatus: 'not_required', resourceStatus: 'reserved', plannedDeparture: '2030-01-01T01:00:00.000Z' };
  const data = (changes = {}, itemChanges = {}) => ({ selectedTrip: null, distributors: [{ distributorUid: 'driver', tripCount: 1, inProgressCount: 1, soleActiveTrip: { ...trip, ...changes }, ...itemChanges }] });
  const valid = loadTripService({ capacityData: data() }); assert.equal((await valid.api.getManagerTripCapacity()).distributors[0].soleActiveTrip.standardContainers, 45);
  for (const invalid of [data({}, { tripCount: 2 }), data({ distributorUid: 'other' }), data({ tripId: ' ' }), data({ state: 'planning', resourceStatus: 'available' }), data({ standardContainers: 61 }), data({ verified: false }), data({ state: 'closed' })]) {
    await assert.rejects(loadTripService({ capacityData: invalid }).api.getManagerTripCapacity(), /could not be verified/);
  }
  await assert.rejects(loadTripService({ capacityData: data() }).api.getManagerTripCapacity('different-trip'), /could not be verified/);
  const unknown = data({ verified: false, standardContainers: null, hasOtherCargo: null, mixedReviewStatus: 'unknown' });
  assert.equal((await loadTripService({ capacityData: unknown }).api.getManagerTripCapacity()).distributors[0].soleActiveTrip.verified, false);
});

test('trip preparation is capability-gated and sends only confirmed Manager actions', async () => {
  const { api, calls, setCapability } = loadTripService();
  const view = await api.getTripPreparation(); assert.equal(view.resources.length, 2);
  await api.prepareManagerTrip({ action: 'create-trip', tripId: 'trip-1', distributorUid: 'driver' });
  await api.prepareManagerTrip({ action: 'assign-distributor', tripId: 'trip-1', orderId: 'order-1', distributorUid: 'driver', scheduledAt: '2030-01-01T00:00:00Z', clientMutationId: 'request-id-1234' });
  await api.prepareManagerTrip({ action: 'approve-trip', tripId: 'trip-1', expectedRevision: 3, mixedLoadConfirmed: true });
  assert.equal(calls.filter((item) => item.url.endsWith('/api/trip-capability')).length, 4);
  const writes = calls.filter((item) => item.init.method === 'PATCH').map((item) => JSON.parse(item.init.body)); assert.equal(writes[2].expectedRevision, 3);
  await assert.rejects(api.prepareManagerTrip({ action: 'reject-trip-loading', tripId: 'trip-1' }), /invalid/);
  setCapability(false); await assert.rejects(api.getTripPreparation(), /unavailable/);
  const unconfirmed = loadTripService({ wrongProposal: true }); await assert.rejects(unconfirmed.api.prepareManagerTrip({ action: 'approve-trip', tripId: 'trip-1', expectedRevision: 3 }), (error) => error.uncertain === true);
});

test('Manager trip preparation requires current mixed-load review before approval', async () => {
  const filename = path.resolve(__dirname, '../../../components/ManagerTripPreparation.jsx');
  const code = babel.transformSync(fs.readFileSync(filename, 'utf8'), { plugins: ['@babel/plugin-transform-modules-commonjs', '@babel/plugin-transform-react-jsx'], configFile: false, babelrc: false }).code;
  const calls = []; const data = { eligibleDistributorUids: ['driver'], resources: [{ id: 'opaque-a', available: true }, { id: 'opaque-b', available: false }], orders: [], trips: [{ tripId: 'trip-1', distributorUid: 'driver', state: 'planning', revision: 3, verified: true, standardContainers: 59, hasOtherCargo: true, plannedResourceId: 'opaque-a', plannedDeparture: '2030-01-01T01:00:00.000Z', estimatedReturn: '2030-01-01T03:00:00.000Z', members: [{ orderId: 'order-1', scheduledAt: '2030-01-01T02:00:00.000Z', cargo: [{ productId: 'bottle', quantity: 1, classification: 'other', description: '24-pack' }] }] }] };
  const service = { getTripPreparation: async () => data, prepareManagerTrip: async (body) => { calls.push(body); }, parseManilaTripTime: (value) => new Date(`${value.replace(' ', 'T')}:00+08:00`), tripMutationId: () => 'request-id-1234' };
  const render = (mixedRevision, mode = 'trip') => {
    let index = 0; const initial = [data, 'trip-1', 'driver', 'opaque-a', '2030-01-01 09:00', '2030-01-01 11:00', '', mixedRevision, '', '', ''];
    const react = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: (fallback) => [index < initial.length ? initial[index++] : fallback, () => {}], useRef: (value) => ({ current: value }), useCallback: (fn) => fn, useEffect() {} };
    const native = Object.fromEntries(['ActivityIndicator', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'View'].map((name) => [name, name])); const module = { exports: {} };
    vm.runInNewContext(code, { module, exports: module.exports, require: (name) => name === 'react' ? react : name === 'react-native' ? native : service });
    return module.exports.default({ mode, distributors: [{ uid: 'driver', name: 'Driver' }], colors: { border: '#ddd', surface: '#fff', textPrimary: '#111', textSecondary: '#333', primary: '#123' } });
  };
  const find = (node, text) => { if (!node || typeof node !== 'object') return null; if (node.type === 'Pressable' && JSON.stringify(node.children || []).includes(`"${text}"`)) return node; for (const child of node.children || []) for (const item of Array.isArray(child) ? child : [child]) { const result = find(item, text); if (result) return result; } return null; };
  assert.equal(render(null, 'default'), null);
  assert.equal(find(render(2), 'Approve reviewed trip').props.disabled, true);
  const approve = find(render(3), 'Approve reviewed trip'); assert.equal(approve.props.disabled, false); await approve.props.onPress();
  assert.equal(calls.length, 1); assert.equal(calls[0].expectedRevision, 3); assert.equal(calls[0].mixedLoadConfirmed, true);
});

test('existing preparation selector shares the selected trip without adding another selector', () => {
  const filename = path.resolve(__dirname, '../../../components/ManagerTripPreparation.jsx');
  const code = babel.transformSync(fs.readFileSync(filename, 'utf8'), { plugins: ['@babel/plugin-transform-modules-commonjs', '@babel/plugin-transform-react-jsx'], configFile: false, babelrc: false }).code;
  const data = { eligibleDistributorUids: ['driver'], resources: [], orders: [], trips: [{ tripId: 'chosen-trip', distributorUid: 'driver', state: 'planning', revision: 0, verified: true, standardContainers: 0, hasOtherCargo: false, plannedResourceId: null, plannedDeparture: null, estimatedReturn: null, members: [] }] };
  let index = 0; const initial = [data, '', '', '', '', '', '', null, '', '', '']; const selected = [];
  const react = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: (fallback) => [index < initial.length ? initial[index++] : fallback, () => {}], useRef: (value) => ({ current: value }), useCallback: (fn) => fn, useEffect() {} };
  const native = Object.fromEntries(['ActivityIndicator', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'View'].map((name) => [name, name])); const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: (name) => name === 'react' ? react : name === 'react-native' ? native : {} });
  const tree = module.exports.default({ mode: 'trip', distributors: [{ uid: 'driver', name: 'Driver' }], colors: { border: '#ddd', surface: '#fff', textPrimary: '#111', textSecondary: '#333', primary: '#123' }, onSelectedTripChange: (tripId) => selected.push(tripId) });
  const find = (node) => { if (!node || typeof node !== 'object') return null; if (node.type === 'Pressable' && JSON.stringify(node.children || []).includes('Driver · Draft · Unscheduled')) return node; for (const child of node.children || []) for (const item of Array.isArray(child) ? child : [child]) { const result = find(item); if (result) return result; } return null; };
  const choice = find(tree); assert.ok(choice); choice.props.onPress(); assert.deepEqual(selected, ['chosen-trip']);
});

test('lifecycle controls recheck capability and reject unsupported or unconfirmed actions', async () => {
  const { api, calls, setCapability } = loadTripService();
  await api.getTripLifecycle('distributor');
  await api.updateTripLifecycle('distributor', 'trip-1', 'report-trip-loading');
  await api.updateTripLifecycle('manager', 'trip-1', 'confirm-trip-unloading');
  assert.equal(calls.filter((item) => item.url.endsWith('/api/trip-capability')).length, 3);
  assert.deepEqual(calls.filter((item) => item.init.method === 'PATCH').map((item) => JSON.parse(item.init.body).action), ['report-trip-loading', 'confirm-trip-unloading']);
  await assert.rejects(api.updateTripLifecycle('distributor', 'trip-1', 'confirm-trip-unloading'), /invalid/);
  await assert.rejects(api.updateTripLifecycle('manager', 'trip-1', 'reject-trip-loading'), /invalid/);
  setCapability(false); await assert.rejects(api.updateTripLifecycle('manager', 'trip-1', 'confirm-trip-loading'), /unavailable/);
  const unconfirmed = loadTripService({ wrongProposal: true });
  await assert.rejects(unconfirmed.api.updateTripLifecycle('manager', 'trip-1', 'confirm-trip-loading'), (error) => error.uncertain === true);
});

test('lifecycle controls show only the authorized next action and suppress duplicate presses', async () => {
  const filename = path.resolve(__dirname, '../../../components/TripLifecycleControls.jsx');
  const code = babel.transformSync(fs.readFileSync(filename, 'utf8'), { plugins: ['@babel/plugin-transform-modules-commonjs', '@babel/plugin-transform-react-jsx'], configFile: false, babelrc: false }).code;
  const calls = []; let complete; const pending = new Promise((resolve) => { complete = resolve; });
  const service = { getTripLifecycle: async () => [], updateTripLifecycle: async (...args) => { calls.push(args); await pending; } };
  const render = (role, state, mode = 'trip') => {
    let index = 0; const initial = [[{ tripId: 'trip-1', distributorUid: 'driver', state }], false, '', '', ''];
    const react = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: (fallback) => [index < initial.length ? initial[index++] : fallback, () => {}], useRef: (value) => ({ current: value }), useCallback: (fn) => fn, useEffect() {} };
    const native = Object.fromEntries(['ActivityIndicator', 'Pressable', 'ScrollView', 'Text', 'View'].map((name) => [name, name])); const module = { exports: {} };
    vm.runInNewContext(code, { module, exports: module.exports, require: (name) => name === 'react' ? react : name === 'react-native' ? native : service });
    return module.exports.default({ mode, role, colors: { border: '#ddd', surface: '#fff', textPrimary: '#111', textSecondary: '#333', primary: '#123' } });
  };
  const find = (node, text) => {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'Pressable' && JSON.stringify(node.children || []).includes(`"${text}"`)) return node;
    for (const child of node.children || []) for (const item of Array.isArray(child) ? child : [child]) { const result = find(item, text); if (result) return result; }
    return null;
  };
  assert.equal(render('manager', 'loading_reported', 'default'), null);
  assert.ok(find(render('distributor', 'resource_reserved'), 'Report loading'));
  assert.ok(find(render('distributor', 'in_transit'), 'Report return and unloading'));
  assert.equal(find(render('distributor', 'loading_reported'), 'Confirm loading and departure'), null);
  assert.equal(find(render('manager', 'closed'), 'Confirm unloading and release'), null);
  const button = find(render('manager', 'return_reported'), 'Confirm unloading and release'); assert.ok(button);
  const first = button.props.onPress(); const second = button.props.onPress(); assert.equal(calls.length, 1);
  complete(); await Promise.all([first, second]); assert.deepEqual(calls[0], ['manager', 'trip-1', 'confirm-trip-unloading']);
});

test('trip UI requests fail closed without verified local emulator connections and backend capability', async () => {
  const production = loadTripService({ qa: false }); assert.equal(await production.api.getVerifiedTripMode(), 'default');
  await assert.rejects(production.api.proposeDistributorSchedule('order-1', '2030-01-01T00:00:00Z', 'request-id-1234'), /unavailable/); assert.equal(production.calls.length, 0);
  const disconnected = loadTripService({ connected: false }); await assert.rejects(disconnected.api.getVerifiedTripMode(), /could not be verified/); assert.equal(disconnected.calls.length, 0);
  const disabled = loadTripService({ capability: false }); await assert.rejects(disabled.api.proposeAdminTrip({ orderId: 'order-1' }), /unavailable/); assert.equal(disabled.calls.length, 1);
  const malformed = loadTripService({ capability: 'yes' }); await assert.rejects(malformed.api.getVerifiedTripMode(), /could not be verified/);
  const mismatch = loadTripService({ backendProject: 'demo-bluetap' }); await assert.rejects(mismatch.api.proposeAdminTrip({ orderId: 'order-1' }), /does not match/); assert.equal(mismatch.calls.length, 1);
});

test('trip UI sends exact Distributor, Manager and Admin actions only after capability checks', async () => {
  const { api, calls } = loadTripService();
  const proposal = await api.proposeDistributorSchedule('order-1', '2030-01-01T00:00:00Z', 'request-id-1234'); assert.equal(proposal.proposal.status, 'pending');
  await api.getManagerTripOptions('order-1', 'proposal-1'); await api.decideManagerProposal('order-1', 'proposal-1', 'approve-distributor-reschedule', 'trip-1');
  await api.decideManagerProposal('order-1', 'proposal-1', 'reject-admin-trip-override');
  await api.proposeAdminTrip({ orderId: 'order-1', distributorUid: 'dist-1', tripId: 'trip-1', scheduledAt: '2030-01-01T00:00:00Z', reason: 'Exception', clientMutationId: 'request-id-1234' });
  assert.equal(calls.filter((entry) => entry.url.endsWith('/api/trip-capability')).length, 5);
  const writes = calls.filter((entry) => entry.init.method === 'PATCH' || entry.init.method === 'POST').map((entry) => JSON.parse(entry.init.body));
  assert.equal(writes[0].action, 'propose-reschedule'); assert.equal(writes[0].clientMutationId, 'request-id-1234');
  assert.equal(writes[1].action, 'approve-distributor-reschedule'); assert.equal(writes[1].tripId, 'trip-1');
  assert.equal(writes[2].action, 'reject-admin-trip-override'); assert.equal(writes[3].action, 'propose-trip-override');
});

test('unconfirmed or failed proposal responses never become success', async () => {
  for (const setup of [{ wrongProposal: true }, { failWrite: true }]) {
    const { api } = loadTripService(setup);
    await assert.rejects(api.proposeDistributorSchedule('order-1', '2030-01-01T00:00:00Z', 'request-id-1234'), (error) => error.uncertain === true);
    await assert.rejects(api.proposeAdminTrip({ orderId: 'order-1', distributorUid: 'dist-1', tripId: 'trip-1', scheduledAt: '2030-01-01T00:00:00Z', reason: 'Exception', clientMutationId: 'request-id-1234' }), (error) => error.uncertain === true);
  }
});

test('trip entry uses Philippine time and rejects malformed calendar dates', () => {
  const { api } = loadTripService();
  assert.equal(api.parseManilaTripTime('2030-01-01 00:15').toISOString(), '2029-12-31T16:15:00.000Z');
  for (const invalid of ['2030-02-30 10:00', '2030-01-01 24:00', '2030-01-01 10:60', 'not a date']) assert.equal(api.parseManilaTripTime(invalid), null);
});

test('portal integration retains separate default and pending approval paths', () => {
  const read = (file) => fs.readFileSync(path.resolve(__dirname, '../../..', file), 'utf8');
  const distributor = read('app/distributor/d_scheduled_requests.jsx'); const manager = read('components/ManagerTripApprovals.jsx'); const admin = read('app/admin/requests.jsx');
  assert.match(distributor, /Pending Manager Approval/); assert.match(distributor, /else await rescheduleAssignedDelivery/); assert.match(distributor, /proposal\.status === 'pending'/);
  assert.match(manager, /approve.*reject/); assert.match(manager, /getManagerTripOptions/); assert.match(manager, /getManagerAdminProposals/);
  assert.match(admin, /Pending Branch Manager Approval/); assert.match(admin, /proposeAdminTrip/); assert.match(admin, /submitAdminOverrideAssignment/); assert.match(admin, /overrideSubmissionLock/);
});

test('Manager approval controls dispatch the selected proposal and stay absent in default mode', async () => {
  const filename = path.resolve(__dirname, '../../../components/ManagerTripApprovals.jsx');
  const code = babel.transformSync(fs.readFileSync(filename, 'utf8'), { plugins: ['@babel/plugin-transform-modules-commonjs', '@babel/plugin-transform-react-jsx'], configFile: false, babelrc: false }).code;
  const calls = []; const service = { getManagerAdminProposals: async () => ({ proposals: [] }), getManagerTripOptions: async () => ({ trips: [] }), decideManagerProposal: async (...args) => { calls.push(args); return args[2].startsWith('approve') ? { order: { id: 'order-1' } } : { proposal: { status: 'rejected' } }; } };
  const order = { id: 'order-1', status: 'scheduled', scheduledAt: '2030-01-01T00:00:00Z' };
  const pending = { kind: 'admin', id: 'proposal-1', order, action: 'reassign', distributorUid: 'dist-1', tripId: 'trip-1', scheduledAt: '2030-01-02T00:00:00Z', reason: 'Operational exception' };
  function render(mode) {
    let index = 0; const initial = [[pending], '', '', false, '', null, [], ''];
    const react = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: (fallback) => [index < initial.length ? initial[index++] : fallback, () => {}], useRef: (value) => ({ current: value }), useMemo: (fn) => fn(), useCallback: (fn) => fn, useEffect() {} };
    const native = Object.fromEntries(['ActivityIndicator', 'Pressable', 'ScrollView', 'Text', 'View'].map((name) => [name, name])); const module = { exports: {} };
    vm.runInNewContext(code, { module, exports: module.exports, require: (name) => name === 'react' ? react : name === 'react-native' ? native : name === '../services/tripApprovals' ? service : { parseTimestamp: (value) => value ? new Date(value) : null } });
    return module.exports.default({ mode, orders: [order], colors: { border: '#ddd', surfaceAlt: '#fff', textPrimary: '#111', textSecondary: '#333', primary: '#123' } });
  }
  function findButton(node, text) {
    if (!node || typeof node !== 'object') return null;
    const content = JSON.stringify(node.children || []);
    if (node.type === 'Pressable' && content.includes(`"${text}"`)) return node;
    for (const child of node.children || []) for (const item of Array.isArray(child) ? child : [child]) { const result = findButton(item, text); if (result) return result; }
    return null;
  }
  assert.equal(render('default'), null);
  const view = render('trip'); const approve = findButton(view, 'Approve'); const reject = findButton(view, 'Reject');
  assert.ok(approve); assert.ok(reject); await approve.props.onPress(); await reject.props.onPress();
  assert.deepEqual(calls.map((args) => args.slice(0, 3)), [['order-1', 'proposal-1', 'approve-admin-trip-override'], ['order-1', 'proposal-1', 'reject-admin-trip-override']]);
});

test('Manager trip selection cannot be reused for another order with the same proposal ID', async () => {
  const filename = path.resolve(__dirname, '../../../components/ManagerTripApprovals.jsx');
  const code = babel.transformSync(fs.readFileSync(filename, 'utf8'), { plugins: ['@babel/plugin-transform-modules-commonjs', '@babel/plugin-transform-react-jsx'], configFile: false, babelrc: false }).code;
  const calls = []; const orderA = { id: 'order-a', status: 'delivery_failed', assignedDistributorUid: 'dist', distributorRescheduleProposals: [{ id: 'same-proposal', orderId: 'order-a', distributorUid: 'dist', status: 'pending' }] };
  const orderB = { ...orderA, id: 'order-b', distributorRescheduleProposals: [{ id: 'same-proposal', orderId: 'order-b', distributorUid: 'dist', status: 'pending' }] };
  const values = [[], '', '', false, '', { id: 'same-proposal', order: orderA }, [{ tripId: 'trip-a' }], 'trip-a']; let index = 0;
  const react = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: () => [values[index++], () => {}], useRef: (value) => ({ current: value }), useMemo: (fn) => fn(), useCallback: (fn) => fn, useEffect() {} };
  const native = Object.fromEntries(['ActivityIndicator', 'Pressable', 'ScrollView', 'Text', 'View'].map((name) => [name, name])); const module = { exports: {} };
  const service = { getManagerAdminProposals: async () => ({ proposals: [] }), getManagerTripOptions: async () => ({ trips: [] }), decideManagerProposal: async (...args) => { calls.push(args); return { order: { id: 'order-a' } }; } };
  vm.runInNewContext(code, { module, exports: module.exports, require: (name) => name === 'react' ? react : name === 'react-native' ? native : name === '../services/tripApprovals' ? service : { parseTimestamp: () => null } });
  const view = module.exports.default({ mode: 'trip', orders: [orderA, orderB], colors: { border: '#ddd', surfaceAlt: '#fff', textPrimary: '#111', textSecondary: '#333', primary: '#123' } });
  const buttons = [];
  function visit(node) { if (!node || typeof node !== 'object') return; if (node.type === 'Pressable' && JSON.stringify(node.children).includes('"Approve"')) buttons.push(node); for (const child of node.children || []) for (const item of Array.isArray(child) ? child : [child]) visit(item); }
  visit(view); assert.equal(buttons.length, 2); assert.equal(buttons[0].props.disabled, false); assert.equal(buttons[1].props.disabled, true);
  await buttons[1].props.onPress(); assert.equal(calls.length, 0); await buttons[0].props.onPress(); assert.equal(calls[0][0], 'order-a');
});
