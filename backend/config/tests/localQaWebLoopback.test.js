const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { EventEmitter } = require('node:events');

const source = readFileSync(resolve(__dirname, '../../../scripts/local-qa-loopback.js'), 'utf8');
const safe = {
  BLUETAP_QA_WEB_PORT: '8081', EXPO_PUBLIC_LOCAL_QA: '1', EXPO_PUBLIC_APP_ENV: 'local-qa',
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'demo-bluetap-local-qa',
  EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1:3000',
  EXPO_PUBLIC_AUTH_EMULATOR_URL: 'http://127.0.0.1:9099',
  EXPO_PUBLIC_FIRESTORE_EMULATOR_HOST: '127.0.0.1', EXPO_PUBLIC_FIRESTORE_EMULATOR_PORT: '8080',
};

function load(env) {
  class Server extends EventEmitter {
    listen(...args) { return args; }
    close() { this.closed = true; }
  }
  class ServerResponse {
    constructor(localPort) { this.req = { socket: { localPort } }; this.headers = {}; }
    setHeader(name, value) { this.headers[name] = value; }
    writeHead() { return this.headers; }
  }
  const proxy = new EventEmitter();
  proxy.listen = (options) => { proxy.options = options; };
  proxy.close = () => { proxy.closed = true; };
  const fakeProcess = { env, exit: (code) => { fakeProcess.exitCode = code; } };
  new Function('require', 'process', source)((name) => {
    if (name === 'node:http') return { Server, ServerResponse };
    if (name === 'node:net') return { createServer: () => proxy };
    throw new Error('Unexpected module');
  }, fakeProcess);
  return { server: new Server(), Response: ServerResponse, proxy, fakeProcess };
}

test('QA Metro listener binds its configured port to loopback', () => {
  const { server, proxy } = load(safe);
  assert.deepEqual(server.listen(8081, undefined), [8081, '127.0.0.1']);
  server.emit('listening');
  assert.deepEqual(proxy.options, { host: '::1', port: 8081, ipv6Only: true });
  server.emit('close');
  assert.equal(proxy.closed, true);
  assert.deepEqual(load(safe).server.listen({ port: 8081, host: '::' }), [{ port: 8081, host: '127.0.0.1' }]);
  assert.deepEqual(server.listen(1234, '::'), [1234, '::']);
});

test('QA web responses restrict scripts and network connections to loopback', () => {
  const { Response } = load(safe);
  const qaHeaders = new Response(8081).writeHead();
  const policy = qaHeaders['Content-Security-Policy'];
  assert.match(policy, /connect-src 'self' http:\/\/127\.0\.0\.1:3000 http:\/\/127\.0\.0\.1:8080 http:\/\/127\.0\.0\.1:9099/);
  assert.doesNotMatch(policy, /https:/);
  assert.equal(new Response(1234).writeHead()['Content-Security-Policy'], undefined);
});

test('QA Metro fails closed when IPv6 localhost is already in use', () => {
  const { server, proxy, fakeProcess } = load(safe);
  server.listen(8081);
  server.emit('listening');
  const originalError = console.error;
  try {
    console.error = () => {};
    proxy.emit('error', new Error('in use'));
  } finally { console.error = originalError; }
  assert.equal(server.closed, true);
  assert.equal(fakeProcess.exitCode, 1);
});

test('QA Metro listener refuses incomplete or non-emulator settings', () => {
  for (const [key, value] of [
    ['EXPO_PUBLIC_LOCAL_QA', '0'], ['EXPO_PUBLIC_FIREBASE_PROJECT_ID', 'another-project'],
    ['EXPO_PUBLIC_API_BASE_URL', 'https://example.test'], ['EXPO_PUBLIC_AUTH_EMULATOR_URL', ''],
    ['EXPO_PUBLIC_FIRESTORE_EMULATOR_HOST', 'example.test'], ['BLUETAP_QA_WEB_PORT', '9999'],
  ]) assert.throws(() => load({ ...safe, [key]: value }), /isolated local emulator configuration/, key);
});
