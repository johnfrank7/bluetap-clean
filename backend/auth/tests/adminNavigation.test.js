const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');

const root = resolve(__dirname, '../../..');
const login = readFileSync(resolve(root, 'components/PrivilegedLogin.jsx'), 'utf8');
// Execute the actual navigation effect with controlled router readiness.
const effect = login.match(/React\.useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[admin, currentPathname/)[1];
const harness = () => {
  const calls = [];
  const context = {
    pendingDestination: '/admin/dashboard', rootNavigationState: undefined,
    navigationCompletedRef: { current: false }, admin: true,
    currentPathname: '/admin/login',
    routerRef: { current: { replace: (path) => calls.push(path) } },
    logPrivilegedStage: (_admin, stage) => calls.push(stage),
    setError: () => {},
  };
  return { calls, context, run: () => vm.runInNewContext(`(() => {${effect}})()`, context) };
};

test('successful login waits for readiness then replaces exactly once across effect reruns', () => {
  const { calls, context, run } = harness();
  run();
  assert.deepEqual(calls, []);
  assert.equal(context.navigationCompletedRef.current, false);
  context.rootNavigationState = { key: 'root' };
  run();
  run();
  context.currentPathname = '/admin/dashboard';
  run();
  assert.deepEqual(calls, ['NAVIGATION_ROUTER_READY', '/admin/dashboard', 'NAVIGATION_EXECUTED']);
});

test('router failure stays outside auth rejection and permits navigation-only retry', () => {
  const { calls, context, run } = harness();
  context.rootNavigationState = { key: 'root' };
  context.routerRef.current.replace = () => { throw new Error('not ready'); };
  run();
  assert.equal(context.navigationCompletedRef.current, false);
  assert.ok(calls.includes('NAVIGATION_FAILED'));
  context.routerRef.current.replace = (path) => calls.push(path);
  run();
  assert.equal(calls.filter((item) => item === '/admin/dashboard').length, 1);
});

test('shared handoff cache requires matching UID, role and unexpired validation', () => {
  const source = readFileSync(resolve(root, 'services/authSession.js'), 'utf8');
  const cacheCode = source.slice(source.indexOf('const PRIVILEGED_VALIDATION_TTL_MS'), source.indexOf('const getMemorySessionStore'))
    .replaceAll('export const', 'const');
  const context = vm.createContext({ normalizeRole: (role) => role || '', Date });
  vm.runInContext(`${cacheCode}\nthis.cache = cacheValidatedPrivilegedAccess; this.read = getCachedPrivilegedAccess; this.clear = clearPrivilegedValidationCache;`, context);
  context.cache({ uid: 'admin-1', role: 'admin' });
  assert.equal(context.read({ uid: 'admin-1' }, 'admin').role, 'admin');
  assert.equal(context.read({ uid: 'manager-1' }, 'admin'), null);
  assert.equal(context.read({ uid: 'admin-1' }, 'manager'), null);
  assert.equal(context.read(null, 'admin'), null);
  vm.runInContext('privilegedValidationCache.validatedAt -= 120001', context);
  assert.equal(context.read({ uid: 'admin-1' }, 'admin'), null);
  context.cache({ uid: 'admin-1', role: 'admin' });
  context.clear();
  assert.equal(context.read({ uid: 'admin-1' }, 'admin'), null);
});
