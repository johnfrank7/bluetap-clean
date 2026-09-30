const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');

function fixture(load) {
  const filename = path.resolve(__dirname, '../../../services/chatRealtime.js');
  const code = babel.transformSync(fs.readFileSync(filename, 'utf8'), { filename, babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'] }).code;
  const exports = {}; let callback; let stopped = 0; const refs = [];
  vm.runInNewContext(code, { exports, setTimeout, clearTimeout, require(name) {
    if (name === './chatApi') return { loadConversationSummaries: load };
    if (name === '../firebase') return { db: {} };
    return { doc(_, collection, id) { return `${collection}/${id}`; }, onSnapshot(ref, onData) { refs.push(ref); callback = onData; return () => stopped++; } };
  } });
  return { subscribe: exports.subscribeConversationSummaries, signal: () => callback(), refs, stopped: () => stopped };
}

test('cold summary load and subsequent incoming/read signals share one private role listener', async () => {
  let unread = 0; const data = [];
  const f = fixture(async () => [{ id: 'same-thread', unreadCount: unread }]);
  const stop = f.subscribe({ role: 'distributor', uid: 'd1', onData: (items) => data.push(items) });
  await f.signal();
  unread = 1; await f.signal();
  unread = 0; await f.signal();
  assert.deepEqual(f.refs, ['chatUserActivity/d1']);
  assert.deepEqual(data.map((items) => items[0].unreadCount), [0, 1, 0]);
  stop(); assert.equal(f.stopped(), 1);
});

test('summary listener rejects empty identity, uses Manager branch, and discards late responses', async () => {
  let finish; let reads = 0;
  const f = fixture(() => { reads++; return new Promise((resolve) => { finish = resolve; }); });
  f.subscribe({ role: 'requester', uid: null, onData() {} });
  assert.equal(f.refs.length, 0);
  const received = [];
  const stop = f.subscribe({ role: 'manager', uid: 'm1', branchId: 'a', onData: (items) => received.push(items) });
  const pending = f.signal();
  assert.equal(reads, 1);
  stop(); finish([{ id: 'private-thread' }]); await pending;
  assert.deepEqual(received, []);
  assert.deepEqual(f.refs, ['chatBranchActivity/a']);
});
