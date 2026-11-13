const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function makeSave({ currentUser = { uid: 'dist-1' }, transactionError, currentAddress = 'Old Road', draftAddress = 'New Road', pause } = {}) {
  const source = fs.readFileSync(path.resolve(__dirname, '../../../app/distributor/d_profile.jsx'), 'utf8');
  const helpers = source.slice(source.indexOf('const getProfileObject ='), source.indexOf('const ProfileField ='));
  const code = source.slice(source.indexOf('  async function saveProfileChanges()'), source.indexOf('\n  const handleLogout ='));
  assert.ok(code.includes('await runTransaction'));
  const profile = { uid: 'dist-1', role: 'distributor', firstName: 'Sample', lastName: 'User', phone: '+639171234567', address: 'Old Road' };
  const state = { local: null, editing: true, draft: null, toast: null, writes: 0 };
  const bindings = {
    auth: { currentUser }, db: {}, userData: profile,
    profileDraft: { fullName: 'Sample User', contactNumber: '+639171234567', address: draftAddress },
    profileDisplay: { email: 'dist@example.test' },
    editBaseline: { current: { fullName: 'Sample User', contactNumber: '+639171234567', address: 'Old Road' } },
    saveInFlight: { current: false },
    normalizePhilippinePhone: (value) => /^\+639\d{9}$/.test(value) ? value : null,
    Alert: { alert: () => {} },
    doc: (_db, _collection, id) => id,
    runTransaction: async (_db, execute) => {
      if (pause) await pause;
      if (transactionError) throw new Error('offline');
      return execute({
        get: async () => ({ exists: () => true, data: () => ({ ...profile, address: currentAddress }) }),
        set: () => { state.writes++; },
      });
    },
    setSavingProfile: () => {}, saveLocalUser: (value) => { state.local = value; },
    setUserData: () => {}, setProfileDraft: (value) => { state.draft = value; },
    setEditingProfile: (value) => { state.editing = value; }, setToast: (value) => { state.toast = value; },
    console: { log: () => {} },
  };
  const make = new Function(...Object.keys(bindings), `${helpers}\n${code}\nreturn saveProfileChanges;`);
  return { save: make(...Object.values(bindings)), state };
}

test('Distributor saves only after confirmed transaction and preserves edits on failure', async () => {
  const successful = makeSave();
  assert.equal(await successful.save(), true);
  assert.equal(successful.state.local.address, 'New Road');
  assert.equal(successful.state.editing, false);
  assert.equal(successful.state.writes, 1);
  for (const options of [{ transactionError: true }, { currentAddress: 'Concurrent Road' }, { currentUser: null }, { draftAddress: '' }]) {
    const failed = makeSave(options);
    assert.equal(await failed.save(), false);
    assert.equal(failed.state.local, null);
    assert.equal(failed.state.draft, null);
    assert.equal(failed.state.editing, true);
    assert.equal(failed.state.writes, 0);
  }
});

test('Distributor save ignores a repeated submission until the transaction completes', async () => {
  let finish;
  const pause = new Promise((resolve) => { finish = resolve; });
  const pending = makeSave({ pause });
  const first = pending.save();
  assert.equal(await pending.save(), false);
  assert.equal(pending.state.writes, 0);
  finish();
  assert.equal(await first, true);
  assert.equal(pending.state.writes, 1);
});
