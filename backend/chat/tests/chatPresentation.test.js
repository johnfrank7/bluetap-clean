const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');
const model = require('../../../components/chat/chatModel');
const filename = resolve(__dirname, '../../../components/chat/ChatDataProvider.jsx');
const transformed = babel.transformSync(readFileSync(filename, 'utf8'), { filename, babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs', '@babel/plugin-transform-react-jsx'] }).code;
const exportsObject = {};
vm.runInNewContext(transformed, { exports: exportsObject, require: (name) => name === './chatModel' ? model : { StyleSheet: { create: (styles) => styles } } });

test('station conversation presentation accepts no order context without crashing or inventing a route', () => {
  const station = exportsObject.presentationFor({ id: 'opaque-test', type: 'distributor_branch' }, 'distributor', { orders: [], profile: { branchName: 'Test station' } });
  assert.equal(station.displayName, 'Test station');
  assert.equal(station.orderReference, '');
  assert.equal(station.orderContextLocal, null);
});

test('active logical participant is readable and sendable; closed, expired and read-only states cannot send', () => {
  const conversation = { status: 'active', participantState: [{ principalType: 'user', principalId: 'r1', accessState: 'active' }] };
  assert.deepEqual(model.conversationAvailability(conversation, 'requester', 'r1'), { readable: true, sendable: true });
  assert.equal(model.conversationAvailability(conversation, 'requester', 'r2').readable, false);
  assert.equal(model.conversationAvailability({ ...conversation, accessEndsAt: new Date(1) }, 'requester', 'r1').sendable, false);
  assert.equal(model.conversationAvailability({ ...conversation, status: 'closed' }, 'requester', 'r1').readable, false);
  assert.deepEqual(model.conversationAvailability({ ...conversation, status: 'read_only', accessEndsAt: new Date(Date.now() + 10000) }, 'requester', 'r1'), { readable: true, sendable: false });
});
