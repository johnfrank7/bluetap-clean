const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');

const root = path.resolve(__dirname, '../../..');
const filename = path.join(root, 'components/ManagerTripCapacity.jsx');
const code = babel.transformSync(fs.readFileSync(filename, 'utf8'), { plugins: ['@babel/plugin-transform-modules-commonjs', '@babel/plugin-transform-react-jsx'], configFile: false, babelrc: false }).code;
function render(snapshot, uid = 'driver', selectionIsExplicit = false) {
  const react = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: (name) => name === 'react' ? react : { Text: 'Text', View: 'View' } });
  return module.exports.default({ snapshot, distributorUid: uid, selectionIsExplicit, colors: { textSecondary: 'text-token', border: 'border-token', primary: 'primary-token' } });
}
function flatten(node) {
  if (Array.isArray(node)) return node.map(flatten).join('');
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  return typeof node === 'object' ? flatten(node.children || []) : String(node);
}
function progress(node) {
  if (!node || typeof node !== 'object') return null;
  if (node.props?.accessibilityRole === 'progressbar') return node;
  for (const child of node.children || []) for (const item of Array.isArray(child) ? child : [child]) { const found = progress(item); if (found) return found; }
  return null;
}
const selected = (standardContainers, extras = {}) => ({ status: 'ready', data: { distributors: [{ distributorUid: 'driver', tripCount: 1, inProgressCount: 0 }], selectedTrip: { tripId: 'trip-1', distributorUid: 'driver', state: 'planning', verified: true, eligible: true, standardContainers, hasOtherCargo: false, mixedReviewStatus: 'not_required', resourceStatus: 'available', plannedDeparture: null, ...extras } } });

test('capacity shows 0, 45 and 60 with a labelled progress indicator', () => {
  for (const count of [0, 45, 60]) {
    const tree = render(selected(count)); const text = flatten(tree);
    assert.ok(text.includes(`${count} / 60 standard 5-gallon`)); assert.ok(text.includes(`${60 - count} remaining`));
    assert.equal(progress(tree).props.accessibilityValue.now, count); assert.equal(progress(tree).props.accessibilityValue.max, 60);
    if (count === 60) assert.match(text, /Full/);
  }
});

test('capacity distinguishes no trip, ambiguous trip, unavailable, stale and in-progress states', () => {
  assert.match(flatten(render({ status: 'loading', data: null })), /Checking/);
  assert.match(flatten(render({ status: 'unavailable', data: null })), /unavailable/);
  assert.match(flatten(render({ status: 'ready', data: { distributors: [], selectedTrip: null } })), /No active trip/);
  const multiple = { status: 'ready', data: { distributors: [{ distributorUid: 'driver', tripCount: 2, inProgressCount: 1 }], selectedTrip: null } };
  assert.match(flatten(render(multiple)), /Select a relevant trip/);
  assert.match(flatten(render({ status: 'ready', data: { distributors: [{ distributorUid: 'driver', tripCount: 1, inProgressCount: 1 }], selectedTrip: null } })), /Trip in progress/);
  assert.doesNotMatch(flatten(render(selected(45), 'other')), /45 \/ 60/);
  assert.match(flatten(render(selected(null, { verified: false }))), /unknown/);
  assert.match(flatten(render(selected(45, { state: 'in_transit' }))), /additional loading unavailable/);
  assert.match(flatten(render(selected(45, { resourceStatus: 'occupied' }))), /resource occupied/);
  assert.match(flatten(render(selected(45, { resourceStatus: 'unscheduled' }))), /availability not confirmed/);
  assert.match(flatten(render(selected(45, { eligible: false }))), /Distributor unavailable/);
});

test('mixed cargo is separate from remaining container positions', () => {
  const required = flatten(render(selected(45, { hasOtherCargo: true, mixedReviewStatus: 'required' })));
  assert.match(required, /Manager review required/); assert.match(required, /do not confirm space for other cargo/);
  assert.match(flatten(render(selected(45, { hasOtherCargo: true, mixedReviewStatus: 'confirmed' }))), /Manager review confirmed/);
  assert.match(flatten(render(selected(45))), /No additional cargo/);
});

test('reload shows one verified active trip read-only and never selects an ambiguous or stale trip', () => {
  const trip = { tripId: 'active-trip', distributorUid: 'driver', state: 'in_transit', verified: true, eligible: true, standardContainers: 45, hasOtherCargo: true, mixedReviewStatus: 'required', resourceStatus: 'reserved', plannedDeparture: '2030-01-01T01:00:00.000Z' };
  const snapshot = { status: 'ready', data: { distributors: [{ distributorUid: 'driver', tripCount: 1, inProgressCount: 1, soleActiveTrip: trip }], selectedTrip: null } };
  const text = flatten(render(snapshot)); assert.match(text, /Only active trip · Read-only/); assert.match(text, /45 \/ 60/); assert.match(text, /additional loading unavailable/); assert.match(text, /Manager review required/);
  assert.doesNotMatch(flatten(render(snapshot, 'driver', true)), /45 \/ 60/);
  assert.doesNotMatch(flatten(render({ ...snapshot, data: { ...snapshot.data, distributors: [{ ...snapshot.data.distributors[0], tripCount: 2 }] } })), /45 \/ 60/);
  assert.doesNotMatch(flatten(render({ ...snapshot, data: { ...snapshot.data, distributors: [{ ...snapshot.data.distributors[0], soleActiveTrip: { ...trip, distributorUid: 'other' } }] } })), /45 \/ 60/);
  assert.doesNotMatch(flatten(render({ ...snapshot, data: { ...snapshot.data, distributors: [{ ...snapshot.data.distributors[0], soleActiveTrip: { ...trip, state: 'closed' } }] } })), /45 \/ 60/);
  const unknown = { ...trip, verified: false, standardContainers: null, hasOtherCargo: null, mixedReviewStatus: 'unknown' };
  assert.match(flatten(render({ ...snapshot, data: { ...snapshot.data, distributors: [{ ...snapshot.data.distributors[0], soleActiveTrip: unknown }] } })), /Active trip capacity unknown/);
  const full = { ...trip, standardContainers: 60, eligible: false, mixedReviewStatus: 'confirmed' };
  const fullText = flatten(render({ ...snapshot, data: { ...snapshot.data, distributors: [{ ...snapshot.data.distributors[0], soleActiveTrip: full }] } })); assert.match(fullText, /60 \/ 60/); assert.match(fullText, /Full/); assert.match(fullText, /Distributor unavailable/); assert.match(fullText, /Manager review confirmed/);
  const explicit = selected(12); explicit.data.distributors[0].soleActiveTrip = trip; assert.match(flatten(render(explicit, 'driver', true)), /12 \/ 60/); assert.doesNotMatch(flatten(render(explicit, 'driver', true)), /45 \/ 60/);
});

test('the existing picker remains default-only for assignment and trip capacity is gated', () => {
  const source = fs.readFileSync(path.join(root, 'app/manager/distributors.jsx'), 'utf8');
  assert.match(source, /tripMode === 'trip' && <ManagerTripCapacity/);
  assert.match(source, /tripMode === 'default' && <>/);
  assert.match(source, /tripMode !== 'default' \|\| assignmentPanelMode !== 'default'/);
  assert.match(source, /onSelectedTripChange=\{setSelectedTripId\}/);
  assert.match(source, /dispatchableOrders\.length === 0[\s\S]*tripMode === 'trip'[\s\S]*capacityMonitorOpen/);
  assert.match(source, /capacityMonitorOpen && <View[\s\S]*distributorOptions\(\)/);
});

test('an empty dispatch queue can open the existing read-only capacity picker only in trip mode', () => {
  const source = fs.readFileSync(path.join(root, 'app/manager/distributors.jsx'), 'utf8') + '\nexport { DistributorDispatchQueue };\n';
  const transformed = babel.transformSync(source, { plugins: ['@babel/plugin-transform-modules-commonjs', '@babel/plugin-transform-react-jsx'], configFile: false, babelrc: false }).code;
  const state = []; let index = 0; let mode = 'trip';
  const react = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useMemo: (fn) => fn(), useEffect() {}, useState(initial) { const slot = index++; if (!(slot in state)) state[slot] = slot === 0 ? { branchId: 'branch', distributors: [{ uid: 'driver', name: 'Driver' }], branches: [] } : typeof initial === 'function' ? initial() : initial; return [state[slot], (value) => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }]; } };
  const native = { ActivityIndicator: 'ActivityIndicator', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput', TouchableOpacity: 'TouchableOpacity', View: 'View', StyleSheet: { create: (value) => value }, Platform: { OS: 'web' } };
  const flow = { setScope() {}, getState: () => ({}), subscribe: () => () => {}, updateDistributors() {} };
  const module = { exports: {} }; const stub = new Proxy({}, { get: () => () => {} });
  vm.runInNewContext(transformed, { module, exports: module.exports, setInterval, clearInterval, setTimeout, clearTimeout, require: (name) => {
    if (name === 'react') return react;
    if (name === 'react-native') return native;
    if (name.endsWith('/managerOperational')) return { getManagerQueues: () => ({ dispatch: [] }), toManagerOrder: (id, order) => order };
    if (name.endsWith('/managerFailedDeliveryResolution')) return { createManagerFailedDeliveryResolutionFlow: () => flow };
    if (name.endsWith('/ManagerRealtimeData')) return { useManagerRealtimeData: () => ({ branchId: 'branch', branch: {}, requests: [], incomingTransfers: [], loading: false }) };
    if (name.endsWith('/tripApprovals')) return { useVerifiedTripMode: () => mode };
    return stub;
  } });
  const styles = new Proxy({}, { get: (_, key) => String(key) }); const colors = { primary: '#123', textPrimary: '#111', textSecondary: '#555', border: '#ddd' };
  const renderQueue = () => { index = 0; return module.exports.DistributorDispatchQueue({ styles, colors, isDark: false }); };
  const button = (node, label) => { if (!node || typeof node !== 'object') return null; if (node.type === 'TouchableOpacity' && flatten(node).includes(label)) return node; for (const child of node.children || []) for (const item of Array.isArray(child) ? child : [child]) { const result = button(item, label); if (result) return result; } return null; };
  let tree = renderQueue(); const open = button(tree, 'View Distributor Capacity'); assert.ok(open); open.props.onPress();
  tree = renderQueue(); assert.match(flatten(tree), /Select Available Distributor/); assert.match(flatten(tree), /Driver/); assert.equal(button(tree, 'Confirm Assignment & Schedule'), null);
  mode = 'default'; tree = renderQueue(); assert.equal(button(tree, 'View Distributor Capacity'), null); assert.equal(button(tree, 'Close Capacity'), null);
});
