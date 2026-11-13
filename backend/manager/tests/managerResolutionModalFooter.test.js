const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');

const source = fs.readFileSync(path.resolve(__dirname, '../../../components/ManagerFailedDeliveryResolutionModal.jsx'), 'utf8');
const code = babel.transformSync(source, { plugins: ['@babel/plugin-transform-modules-commonjs', '@babel/plugin-transform-react-jsx'], configFile: false, babelrc: false }).code;

function render(state, flow, onSuccess = () => {}) {
  const react = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useMemo: (fn) => fn(), useState: () => [false, () => {}] };
  const native = Object.fromEntries(['ActivityIndicator', 'KeyboardAvoidingView', 'Modal', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'TouchableOpacity', 'View'].map((name) => [name, name]));
  Object.assign(native, { Platform: { OS: 'web' }, StyleSheet: { create: (styles) => styles }, useWindowDimensions: () => ({ width: 390, height: 800 }) });
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: (name) => {
    if (name === 'react') return react;
    if (name === 'react-native') return native;
    if (name === './DropdownChevron') return 'DropdownChevron';
    return require('../../../services/managerFailedDeliveryResolution');
  } });
  return module.exports.default({ state: { visible: true, order: { id: 'order-1', assignedDistributorUid: 'd1', branchId: 'b1' }, selectedDayOffset: 0, selectedSlotIndex: 0, reason: 'Customer requested', distributors: [], ...state }, flow, colors: {}, onSuccess });
}

function find(node, label) {
  if (!node || typeof node !== 'object') return null;
  if (node.props?.accessibilityLabel === label) return node;
  for (const child of node.children || []) {
    for (const item of Array.isArray(child) ? child : [child]) {
      const found = find(item, label);
      if (found) return found;
    }
  }
  return null;
}

test('resolution footer keeps review, confirmation, back, cancel, and pending actions distinct', async () => {
  const calls = [];
  const flow = { close: () => calls.push('close'), cancelConfirmation: () => calls.push('back'), requestConfirmation: () => calls.push('review'), submit: async () => { calls.push('submit'); return { ok: true }; } };
  for (const mode of ['reschedule', 'reassign']) {
    const draft = render({ mode }, flow);
    find(draft, 'Cancel failed delivery resolution').props.onPress();
    const review = find(draft, mode === 'reschedule' ? 'Review Reschedule Delivery' : 'Review Reassign Distributor');
    assert.equal(review.props.disabled, mode === 'reassign');
    if (mode === 'reschedule') review.props.onPress();
    const confirmation = render({ mode, confirming: true }, flow, () => calls.push('success'));
    find(confirmation, 'Back to edit schedule').props.onPress();
    const confirmLabel = mode === 'reschedule' ? 'Confirm Reschedule Delivery' : 'Confirm Reassign Distributor';
    await find(confirmation, confirmLabel).props.onPress();
    const pending = render({ mode, confirming: true, submitting: true }, flow);
    assert.equal(find(pending, confirmLabel).props.disabled, true);
    assert.equal(find(pending, 'Back to edit schedule').props.disabled, true);
  }
  assert.deepEqual(calls, ['close', 'review', 'back', 'submit', 'success', 'close', 'back', 'submit', 'success']);
});
