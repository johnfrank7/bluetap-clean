const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const babel = require('@babel/core');

function loadModuleWithMocks(relPath, mockMap = {}) {
  const fullPath = path.resolve(__dirname, relPath);
  const code = fs.readFileSync(fullPath, 'utf8');
  const transformed = babel.transformSync(code, {
    presets: ['babel-preset-expo'],
    filename: fullPath,
  }).code;

  const mod = { exports: {} };
  const mockRequire = (id) => {
    if (mockMap[id]) return mockMap[id];
    if (id === 'react') return require('react');
    if (id === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (id === 'react-native') {
      return {
        View: 'View',
        Text: 'Text',
        TextInput: 'TextInput',
        StyleSheet: { create: (s) => s },
        TouchableOpacity: 'TouchableOpacity',
        ScrollView: 'ScrollView',
        KeyboardAvoidingView: 'KeyboardAvoidingView',
        Platform: { OS: 'web', select: (obj) => obj.web || {} },
        Image: 'Image',
        Alert: { alert: () => {} },
        useWindowDimensions: () => ({ width: 400 }),
      };
    }
    if (id === 'react-native-safe-area-context') {
      return {
        SafeAreaView: 'SafeAreaView',
        useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
      };
    }
    if (id === 'expo-linear-gradient') return { LinearGradient: 'LinearGradient' };
    if (id === 'expo-status-bar') return { StatusBar: () => null };
    if (id === 'expo-router') return { useRouter: () => ({ replace: () => {}, push: () => {} }) };
    if (!id.startsWith('.')) return require(id);
    return {};
  };

  const fn = new Function('require', 'module', 'exports', transformed);
  fn(mockRequire, mod, mod.exports);
  return mod.exports;
}

const shadowStylesMock = { createShadow: () => ({}) };
const themeMock = { useBlueTapTheme: () => ({ colors: {}, isDark: false }) };

test('Requester route exports valid default and named callable React component', () => {
  const requesterMod = loadModuleWithMocks('../../../app/requester/bluetap_AI.jsx', {
    '../../components/RoleDataProviders': { useRequesterData: () => ({}) },
    '../../components/ModerationNotices': { useModerationNotices: () => ({}) },
    '../../components/RoleNotifications': { useRoleNotifications: () => ({}) },
    '../../services/assistant/assistantContext': { buildSafeAssistantContext: () => ({}) },
    '../../services/requesterOrdering': { getActiveProducts: async () => [] },
    '../../components/assistant/AssistantScreen': function MockScreen() { return null; },
  });
  assert.equal(typeof requesterMod.default, 'function', 'Requester route default export must be a function');
  assert.equal(typeof requesterMod.RequesterBlueTapAIPage, 'function', 'Requester route named export must be a function');
});

test('Distributor route exports valid default and named callable React component', () => {
  const distributorMod = loadModuleWithMocks('../../../app/distributor/bluetap_AI.jsx', {
    '../../components/RoleDataProviders': { useDistributorData: () => ({}) },
    '../../components/ModerationNotices': { useModerationNotices: () => ({}) },
    '../../components/RoleNotifications': { useRoleNotifications: () => ({}) },
    '../../services/assistant/assistantContext': { buildSafeDistributorContext: () => ({}) },
    '../../components/assistant/AssistantScreen': function MockScreen() { return null; },
  });
  assert.equal(typeof distributorMod.default, 'function', 'Distributor route default export must be a function');
  assert.equal(typeof distributorMod.DistributorBlueTapAIPage, 'function', 'Distributor route named export must be a function');
});

test('AssistantScreen exports valid default and named callable React component', () => {
  const screenMod = loadModuleWithMocks('../../../components/assistant/AssistantScreen.jsx', {
    '../BlueTapTheme': themeMock,
    '../shadowStyles': shadowStylesMock,
    '../../constants/userPortalLayout': { USER_PORTAL_LAYOUT: { maxWidth: 480, navHeight: 64, navBottomOffset: 16 } },
    '../chat/ChatContext': { useChat: () => ({}) },
    '../../services/assistant/assistantEngine': { defaultAssistantEngine: { respond: async () => ({}) } },
    '../../services/assistant/assistantActions': { executeAssistantAction: async () => ({}) },
    './AssistantMessageBubble': function MockBubble() { return null; },
    './AssistantQuickActions': function MockActions() { return null; },
    './AssistantComposer': function MockComposer() { return null; },
    '../../services/assistant/assistantStorage': {
      loadDailyAssistantChat: async () => [],
      saveDailyAssistantChat: async () => true,
      clearDailyAssistantChat: async () => true,
    },
  });
  assert.equal(typeof screenMod.default, 'function', 'AssistantScreen default export must be a function');
  assert.equal(typeof screenMod.AssistantScreen, 'function', 'AssistantScreen named export must be a function');
});

test('Assistant child components export valid callable React components', () => {
  const cardsMod = loadModuleWithMocks('../../../components/assistant/AssistantCards.jsx', {
    '../BlueTapTheme': themeMock,
    '../shadowStyles': shadowStylesMock,
  });
  assert.equal(typeof cardsMod.default, 'function', 'AssistantCards default export must be a function');
  assert.equal(typeof cardsMod.OrderCard, 'function', 'OrderCard must be a function');
  assert.equal(typeof cardsMod.DeliveryCard, 'function', 'DeliveryCard must be a function');
  assert.equal(typeof cardsMod.RestrictionCard, 'function', 'RestrictionCard must be a function');
  assert.equal(typeof cardsMod.NotificationCard, 'function', 'NotificationCard must be a function');
  assert.equal(typeof cardsMod.ProviderCard, 'function', 'ProviderCard must be a function');
  assert.equal(typeof cardsMod.HelpCard, 'function', 'HelpCard must be a function');

  const composerMod = loadModuleWithMocks('../../../components/assistant/AssistantComposer.jsx', {
    '../BlueTapTheme': themeMock,
    '../shadowStyles': shadowStylesMock,
  });
  assert.equal(typeof composerMod.default, 'function', 'AssistantComposer default export must be a function');
  assert.equal(typeof composerMod.AssistantComposer, 'function', 'AssistantComposer named export must be a function');

  const bubbleMod = loadModuleWithMocks('../../../components/assistant/AssistantMessageBubble.jsx', {
    '../BlueTapTheme': themeMock,
    '../shadowStyles': shadowStylesMock,
    './AssistantCards': cardsMod,
  });
  assert.equal(typeof bubbleMod.default, 'function', 'AssistantMessageBubble default export must be a function');
  assert.equal(typeof bubbleMod.AssistantMessageBubble, 'function', 'AssistantMessageBubble named export must be a function');

  const quickActionsMod = loadModuleWithMocks('../../../components/assistant/AssistantQuickActions.jsx', {
    '../BlueTapTheme': themeMock,
    '../shadowStyles': shadowStylesMock,
    '../../services/assistant/assistantIntents': { ASSISTANT_INTENTS: {} },
  });
  assert.equal(typeof quickActionsMod.default, 'function', 'AssistantQuickActions default export must be a function');
  assert.equal(typeof quickActionsMod.AssistantQuickActions, 'function', 'AssistantQuickActions named export must be a function');
});

test('Assistant storage exports functions without regression', () => {
  const storageMod = loadModuleWithMocks('../../../services/assistant/assistantStorage.js', {
    '@react-native-async-storage/async-storage': {
      getItem: async () => null,
      setItem: async () => {},
      removeItem: async () => {},
      getAllKeys: async () => [],
      multiRemove: async () => {},
    },
  });
  assert.equal(typeof storageMod.saveDailyAssistantChat, 'function');
  assert.equal(typeof storageMod.loadDailyAssistantChat, 'function');
  assert.equal(typeof storageMod.clearDailyAssistantChat, 'function');
  assert.equal(typeof storageMod.buildAssistantStorageKey, 'function');
  assert.equal(typeof storageMod.default, 'object');
  assert.equal(typeof storageMod.default.saveDailyAssistantChat, 'function');
  assert.equal(typeof storageMod.default.loadDailyAssistantChat, 'function');
  assert.equal(typeof storageMod.default.clearDailyAssistantChat, 'function');
});
