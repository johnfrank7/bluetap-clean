const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');

const source = fs.readFileSync(path.resolve(__dirname, '../../../components/ManagerProfileHeader.jsx'), 'utf8');
const code = babel.transformSync(source, { plugins: ['@babel/plugin-transform-modules-commonjs', '@babel/plugin-transform-react-jsx'], configFile: false, babelrc: false }).code;

function render(overrides = {}) {
  const react = { createElement: (type, attributes, ...children) => ({ type, attributes: attributes || {}, children }) };
  const module = { exports: {} };
  const imports = {
    react,
    'react-native': { ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', StyleSheet: { create: (styles) => styles }, Text: 'Text', View: 'View' },
    'expo-image': { Image: 'Image' },
    './BlueTapIcon': 'BlueTapIcon',
    './ManagerShell': { ManagerPill: 'ManagerPill' },
    './ProfileAvatar': 'ProfileAvatar',
    '../assets/icons/sidebar/camera.svg': 'camera',
    '../assets/icons/sidebar/trash-2.svg': 'trash',
  };
  vm.runInNewContext(code, { module, exports: module.exports, require: (name) => imports[name] });
  const colors = { border: 'border', primary: 'primary', primarySoft: 'primarySoft', surface: 'surface', textPrimary: 'textPrimary', textSecondary: 'textSecondary', danger: 'danger', dangerSoft: 'dangerSoft' };
  return module.exports.default({ colors, name: 'A long manager name', photoUri: 'preview', ...overrides });
}

function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  return [node, ...(node.children || []).flatMap(nodes)];
}

test('Manager header displays the supplied avatar and shows compact photo actions only while editing', () => {
  const view = nodes(render());
  assert.equal(view.find((node) => node.type === 'ProfileAvatar').attributes.uri, 'preview');
  assert.equal(view.filter((node) => node.attributes.accessibilityLabel === 'Change photo').length, 0);
  const editing = nodes(render({ editing: true, canRemovePhoto: true }));
  const actions = editing.find((node) => node.type === 'View' && node.attributes.style?.flexWrap === 'wrap');
  assert.ok(actions);
  assert.deepEqual(Array.from(actions.children.filter(Boolean), (node) => node.attributes.accessibilityLabel), ['Change photo', 'Remove photo']);
});

test('photo action callbacks are preserved and disabled during a save', () => {
  const choose = () => {};
  const remove = () => {};
  const editing = nodes(render({ editing: true, canRemovePhoto: true, saving: true, onChoosePhoto: choose, onRemovePhoto: remove }));
  const change = editing.find((node) => node.attributes.accessibilityLabel === 'Change photo');
  const discardPhoto = editing.find((node) => node.attributes.accessibilityLabel === 'Remove photo');
  assert.equal(change.attributes.onPress, choose);
  assert.equal(discardPhoto.attributes.onPress, remove);
  assert.equal(change.attributes.disabled, true);
  assert.equal(discardPhoto.attributes.disabled, true);
  assert.equal(change.attributes.style({ focused: true })[1].borderColor, 'primary');
  assert.equal(discardPhoto.attributes.style({ focused: true })[2].backgroundColor, 'dangerSoft');
  assert.equal(nodes(render({ editing: true, canRemovePhoto: false })).some((node) => node.attributes.accessibilityLabel === 'Remove photo'), false);
});
