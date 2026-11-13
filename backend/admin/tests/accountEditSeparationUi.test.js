const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;

// Exercise the actual editor save callbacks with isolated state and mocked network calls.
function editorCallback(file, name, context) {
  const source = fs.readFileSync(path.join(__dirname, '../../../app/admin', file), 'utf8');
  const tree = parser.parse(source, { sourceType: 'module', plugins: ['jsx'] });
  let callback;
  traverse(tree, { VariableDeclarator(node) { if (node.node.id.name === name) callback = node.node.init; } });
  assert.ok(callback, `Missing ${name}`);
  return vm.runInNewContext(`(${generate(callback).code})`, context);
}

test('Accounts editor saves one section and retains the other section draft', async () => {
  const initial = { fullName: 'Old Name', email: 'old@example.test', username: '', role: 'distributor', branchId: 'north', sessionIdleTimeoutOverrideMinutes: null, temporaryPassword: '', requirePasswordChange: false };
  let draft = { ...initial, fullName: 'New Name', branchId: 'south' };
  const initialDraftRef = { current: initial }; const requests = []; let closed = false;
  const context = { draft, initialDraftRef, account: { role: 'distributor' }, branchDirty: true, accountDirty: true,
    onSave: async (_account, payload) => { requests.push(payload); return { mustChangePassword: false }; },
    setDraft: (update) => { draft = update(draft); }, onClose: () => { closed = true; } };
  assert.equal(await editorCallback('managers.jsx', 'saveDraft', context)('branch', true), false);
  assert.equal(requests.length, 1); assert.equal(requests[0].branchId, 'south'); assert.equal(Object.keys(requests[0]).length, 1);
  assert.equal(initialDraftRef.current.branchId, 'south'); assert.equal(draft.fullName, 'New Name'); assert.equal(closed, false);
  context.draft = draft; context.branchDirty = false;
  assert.equal(await editorCallback('managers.jsx', 'saveDraft', context)('all', true), true);
  assert.equal(requests.length, 2); assert.equal(requests[1].fullName, 'New Name'); assert.equal('branchId' in requests[1], false); assert.equal(closed, true);
});

test('Distributor editor retains branch or account draft after an independent save', async () => {
  for (const section of ['branch', 'account']) {
    let edit = { item: { uid: 'distributor-1', branchId: 'north', fullName: 'Old Name', email: 'old@example.test' }, branchId: 'south', fullName: 'New Name', email: 'new@example.test' };
    const requests = []; let closed = false;
    const context = { edit, busy: '', setBusy() {}, setActionError() {}, notify() {}, refreshDistributors: async () => {},
      manageAdminAccount: async (_uid, _action, payload) => { requests.push(payload); return { ...edit.item, ...payload }; },
      setEdit: (update) => { if (update === null) closed = true; else edit = update(edit); } };
    assert.equal(await editorCallback('distributors.jsx', 'saveEdit', context)(section, true), false);
    assert.equal(requests.length, 1); assert.equal(closed, false);
    if (section === 'branch') {
      assert.deepEqual(Object.keys(requests[0]), ['branchId']); assert.equal(edit.item.branchId, 'south'); assert.equal(edit.fullName, 'New Name'); assert.equal(edit.item.fullName, 'Old Name');
    } else {
      assert.equal('branchId' in requests[0], false); assert.equal(edit.branchId, 'south'); assert.equal(edit.item.branchId, 'north'); assert.equal(edit.item.fullName, 'New Name');
    }
  }
});

test('a failed section save preserves the account editor draft and does not close it', async () => {
  const initial = { fullName: 'Old Name', email: 'old@example.test', username: '', role: 'distributor', branchId: 'north', sessionIdleTimeoutOverrideMinutes: null, temporaryPassword: '', requirePasswordChange: false };
  const draft = { ...initial, fullName: 'New Name', branchId: 'south' }; const initialDraftRef = { current: initial }; let closed = false; let requests = 0;
  const context = { draft, initialDraftRef, account: { role: 'distributor' }, branchDirty: true, accountDirty: true,
    onSave: async () => { requests++; return null; }, setDraft: () => assert.fail('failed save must not update the draft'), onClose: () => { closed = true; } };
  assert.equal(await editorCallback('managers.jsx', 'saveDraft', context)('all', true), false);
  assert.equal(requests, 0);
  assert.equal(await editorCallback('managers.jsx', 'saveDraft', context)('account', true), false);
  assert.equal(requests, 1); assert.equal(initialDraftRef.current.branchId, 'north'); assert.equal(draft.fullName, 'New Name'); assert.equal(closed, false);
});
