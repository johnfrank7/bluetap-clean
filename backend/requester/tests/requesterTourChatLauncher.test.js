const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { transformSync } = require('@babel/core');

const filename = path.resolve(__dirname, '../../../components/chat/ChatFloatingLauncher.jsx');
const state = { role: 'requester', active: false };
const mocks = {
  react: { ...React, useRef: (value) => ({ current: value }), useState: (value) => [value, () => {}], useEffect: () => {} },
  'react-native': {
    AccessibilityInfo: {}, Animated: { Value: class {}, View: 'AnimatedView' }, Easing: {}, Platform: { OS: 'web' },
    Pressable: 'Pressable', Text: 'Text', View: 'View', useWindowDimensions: () => ({ width: 390 }),
    StyleSheet: { create: (styles) => styles, absoluteFill: {} },
  },
  'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
  'expo-router': { usePathname: () => '/requester/r_dashboard' },
  '../../constants/userPortalLayout': { USER_PORTAL_LAYOUT: { maxWidth: 600, navBottomOffset: 10, navHeight: 64 } },
  '../ManagerOngoingRequestsMonitor': { ManagerOngoingRequestsButton: 'Monitor', useManagerOngoingRequests: () => ({ isOpen: false }) },
  './BlueTapChatIcon': { __esModule: true, default: 'ChatIcon' },
  './ChatContext': { useChat: () => ({ role: state.role, colors: {}, openChat: state.openChat, panelOpen: false, totalUnread: 3, totalUnreadLabel: '3' }) },
  './ChatPanel': { __esModule: true, default: 'ChatPanel' },
  '../RequesterTutorialModal': { useRequesterTour: () => ({ active: state.active }) },
};
const { code } = transformSync(fs.readFileSync(filename, 'utf8'), { filename, babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-react-jsx', '@babel/plugin-transform-modules-commonjs'] });
const moduleUnderTest = { exports: {} };
new Function('require', 'module', 'exports', code)((name) => mocks[name], moduleUnderTest, moduleUnderTest.exports);

function elements(element) {
  if (!element || typeof element !== 'object') return [];
  return [element, ...React.Children.toArray(element.props.children).flatMap(elements)];
}

test('tour hides Requester floating chat launcher; leaving restores unread badge and chat action', () => {
  let opened = 0;
  state.role = 'requester'; state.openChat = () => { opened++; }; state.active = true;
  let tree = elements(moduleUnderTest.exports.default());
  assert.equal(tree.some((e) => e.props.accessibilityLabel?.startsWith('Open BlueTap messages')), false);
  assert.ok(tree.some((e) => e.type === 'ChatPanel'));
  state.active = false;
  tree = elements(moduleUnderTest.exports.default());
  const launcher = tree.find((e) => e.props.accessibilityLabel?.startsWith('Open BlueTap messages'));
  assert.match(launcher.props.accessibilityLabel, /3 unread/);
  launcher.props.onPress();
  assert.equal(opened, 1);
});

test('tour visibility does not suppress the Distributor or Manager launcher', () => {
  for (const role of ['distributor', 'manager']) {
    state.role = role; state.active = true;
    const tree = elements(moduleUnderTest.exports.default());
    assert.ok(tree.some((e) => e.props.accessibilityLabel?.startsWith('Open BlueTap messages')));
  }
});
