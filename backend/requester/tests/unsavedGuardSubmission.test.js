const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');
const { profileDraftsDiffer } = require('../../../services/profileDraftComparison');

test('profile dirty comparison handles unchanged, reverted, whitespace, phone formatting, and edited values', () => {
  const normalizePhone = (value) => value.replace(/\D/g, '').replace(/^63/, '0');
  const original = { fullName: 'A Person', phone: '09123456789', address: 'Road' };
  assert.equal(profileDraftsDiffer(original, original, normalizePhone), false);
  assert.equal(profileDraftsDiffer({ ...original, fullName: ' B Person ' }, original, normalizePhone), true);
  assert.equal(profileDraftsDiffer({ ...original, fullName: ' A Person ', phone: '+63 912 345 6789', address: ' Road ' }, original, normalizePhone), false);
  assert.equal(profileDraftsDiffer({ ...original, address: 'New Road' }, original, normalizePhone), true);
  assert.equal(profileDraftsDiffer({ ...original }, original, normalizePhone), false);
});

function mountGuard({ isDirty, isSubmitting, onSave, onDiscard, navigationManaged }) {
  const listeners = {};
  const react = {
    useState: (initial) => [initial, () => {}],
    useRef: (value) => ({ current: value }),
    useEffect: (effect) => effect(),
    useCallback: (callback) => callback,
  };
  const source = fs.readFileSync(path.resolve(__dirname, '../../../components/useUnsavedChangesGuard.js'), 'utf8');
  const code = babel.transformSync(source, {
    plugins: ['@babel/plugin-transform-modules-commonjs', '@babel/plugin-transform-react-jsx'],
    configFile: false,
    babelrc: false,
  }).code;
  const module = { exports: {} };
  const window = {
    addEventListener: (name, listener) => { listeners[name] = listener; },
    removeEventListener: () => {},
    history: { pushState: () => {}, back: () => {} },
    location: { href: '/profile' },
  };
  vm.runInNewContext(code, {
    module, exports: module.exports, window,
    require: (name) => name === 'react' ? react : name === 'react-native'
      ? { Platform: { OS: 'web' } } : () => null,
  });
  return { guard: module.exports.default({ isDirty, isSubmitting, onSave, onDiscard, navigationManaged }), listeners };
}

test('pending submission blocks guarded navigation and browser unload even if form is no longer dirty', () => {
  const { guard, listeners } = mountGuard({ isDirty: false, isSubmitting: true });
  let navigated = false;
  assert.equal(guard.confirmLeave(() => { navigated = true; }), false);
  assert.equal(navigated, false);
  let prevented = false;
  const event = { preventDefault: () => { prevented = true; } };
  listeners.beforeunload(event);
  assert.equal(prevented, true);
  assert.equal(event.returnValue, '');
});

test('save and leave waits for explicit success and blocks duplicates while pending', async () => {
  let finish;
  let saves = 0;
  let navigations = 0;
  const { guard, listeners } = mountGuard({ isDirty: true, navigationManaged: true, onSave: () => { saves++; return new Promise((resolve) => { finish = resolve; }); } });
  assert.equal(guard.confirmLeave(() => { navigations++; }), false);
  const saving = guard.handleSaveAndLeave();
  await guard.handleSaveAndLeave();
  guard.handleDiscardAndLeave();
  guard.handleContinueEditing();
  guard.confirmLeave(() => { navigations += 10; });
  let prevented = false;
  listeners.beforeunload({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(saves, 1);
  assert.equal(navigations, 0);
  finish(true);
  await saving;
  assert.equal(navigations, 1);
  assert.equal(listeners.popstate, undefined);
});

test('failed, undefined, or rejected saves never navigate and allow retry or discard', async () => {
  for (const onSave of [async () => false, async () => undefined, async () => { throw new Error('offline'); }]) {
    let navigations = 0;
    let discarded = 0;
    const { guard } = mountGuard({ isDirty: true, onSave, onDiscard: () => { discarded++; } });
    guard.confirmLeave(() => { navigations++; });
    await guard.handleSaveAndLeave();
    assert.equal(navigations, 0);
    assert.equal(discarded, 0);
    guard.handleDiscardAndLeave();
    assert.equal(discarded, 1);
    assert.equal(navigations, 1);
  }
});

test('continue editing clears the pending navigation without saving', async () => {
  let navigations = 0;
  let saves = 0;
  const { guard } = mountGuard({ isDirty: true, onSave: async () => { saves++; return true; } });
  guard.confirmLeave(() => { navigations++; });
  guard.handleContinueEditing();
  await guard.handleSaveAndLeave();
  assert.equal(navigations, 0);
  assert.equal(saves, 0);
});

test('a clean idle form permits navigation without a browser unload warning', () => {
  const { guard, listeners } = mountGuard({ isDirty: false, isSubmitting: false });
  let navigated = false;
  assert.equal(guard.confirmLeave(() => { navigated = true; }), true);
  assert.equal(navigated, true);
  let prevented = false;
  listeners.beforeunload({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false);
});
