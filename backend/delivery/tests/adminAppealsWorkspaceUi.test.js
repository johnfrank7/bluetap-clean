const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');
const { transformSync } = require('@babel/core');

test('returning to an uncertain appeal restores the original decision and mutation ID', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../../components/AdminDeliveryAppealsWorkspace.jsx'), 'utf8');
  const ast = parser.parse(source, { sourceType: 'module', plugins: ['jsx'] });
  const declaration = ast.program.body.find((entry) => entry.type === 'ExportDefaultDeclaration').declaration;
  const code = transformSync(source.slice(declaration.start, declaration.end), {
    babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-react-jsx'],
  }).code;
  const states = [], refs = [];
  let stateIndex = 0, refIndex = 0;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(initial) { const i = stateIndex++; if (!(i in states)) states[i] = initial;
      return [states[i], (value) => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
    useRef(initial) { const i = refIndex++; if (!refs[i]) refs[i] = { current: initial }; return refs[i]; },
    useMemo: (fn) => fn(), useCallback: (fn) => fn, useEffect() {},
  };
  const a = 'a'.repeat(64), b = 'b'.repeat(64);
  const pending = Object.freeze({ attemptId: a, resolution: 'overturned', overturnedResponsibility: 'shared',
    resolutionReason: 'A factual reason for the original decision.', clientMutationId: 'stable-mutation-id' });
  const components = ['ActivityIndicator', 'Modal', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'View', 'SidebarIcon', 'ReportsSafetyWebStyles'];
  const dependencies = { React, ...Object.fromEntries(components.map((name) => [name, name])),
    useAdminTheme: () => ({ colors: {} }), useWindowDimensions: () => ({ width: 1440 }),
    makeStyles: () => new Proxy({}, { get: () => ({}) }), useModerationActivitySignal: () => 0,
    fetchAdminAppealDetail: async (id) => ({ appeal: { attemptId: id, orderId: id === a ? 'order-a' : 'order-b',
      appeal: { state: 'submitted' } } }), fetchAdminAppeals() {}, fetchAdminDeliveryPenalty() {},
    fetchAdminDeliveryPenaltyReviews() {}, resolveAdminAppeal() {}, normalize: (value) => String(value || '').trim(),
    dateLabel: () => 'date', REPLACEMENTS: [['shared', 'Shared responsibility']] };
  const Page = new Function(...Object.keys(dependencies), `${code}\nreturn AdminDeliveryAppealsWorkspace;`)(...Object.values(dependencies));
  const render = () => { stateIndex = 0; refIndex = 0; return Page({}); };
  const find = (node, predicate) => {
    if (!node || typeof node !== 'object') return null;
    if (predicate(node)) return node;
    for (const child of node.children || []) { const found = find(child, predicate); if (found) return found; }
    return null;
  };
  render();
  states[1] = [{ attemptId: a, orderId: 'order-a' }, { attemptId: b, orderId: 'order-b' }];
  refs[5].current = pending;
  for (const order of ['order-a', 'order-b', 'order-a']) {
    const button = find(render(), (node) => node.props.accessibilityLabel === `Open appeal for order ${order}`);
    assert.ok(button);
    await button.props.onPress();
  }
  const page = render();
  assert.equal(refs[5].current, pending);
  assert.equal(states[20], 'overturned');
  assert.equal(states[21], 'shared');
  assert.equal(states[22], pending.resolutionReason);
  const review = find(page, (node) => node.props.accessibilityLabel === 'Retry original appeal resolution');
  assert.ok(review);
  review.props.onPress();
  const modal = find(render(), (node) => node.type === 'Modal');
  assert.equal(modal.props.visible, true);
  assert.equal(refs[5].current.clientMutationId, 'stable-mutation-id');
});
