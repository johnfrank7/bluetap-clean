const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const { createManagerProfileHandler, safeManagerProfile, validateProfileChanges } = require('../profileHandler');
const { decodeAvatarImage } = require('../../services/supabaseAvatarStorage');
const { isValidManagerPhone } = require('../../../services/managerPhone');
const { changedProfileFields } = require('../../../services/profileDraftComparison');
const { normalizePhilippinePhone } = require('../../../services/phoneUtils');

test('only changed personal fields are sent, including photo-only and no-op edits', () => {
  const baseline = { fullName: 'Manager One', phone: '+639171234567', address: 'Original Road' };
  assert.deepEqual(changedProfileFields({ ...baseline, phone: '0917 123 4567' }, baseline, normalizePhilippinePhone), {});
  assert.deepEqual(changedProfileFields({ ...baseline, address: ' New Road ' }, baseline, normalizePhilippinePhone), { address: 'New Road' });
  assert.deepEqual(changedProfileFields({ ...baseline, phone: '09181234567' }, baseline, normalizePhilippinePhone), { phone: '+639181234567' });
});

function fixture(profileOverrides = {}) {
  const records = new Map([
    ['users/manager-1', { role: 'manager', managerStatus: 'active', branchId: 'north', email: 'manager@example.test', fullName: 'Manager One', ...profileOverrides }],
    ['branches/north', { name: 'North', status: 'active' }],
  ]);
  const snapshot = (path) => ({ id: path.split('/').pop(), exists: records.has(path), data: () => records.get(path) });
  const collection = (name) => ({
    doc(id) {
      const path = `${name}/${id}`;
      return {
        id, path,
        get: async () => snapshot(path),
        set: async (data, options) => records.set(path, options?.merge ? { ...(records.get(path) || {}), ...data } : data),
      };
    },
  });
  let tail = Promise.resolve();
  const db = {
    collection,
    runTransaction: (run) => {
      const execute = async () => {
        const writes = [];
        const result = await run({
          get: async (ref) => { assert.equal(writes.length, 0, 'transaction reads must precede writes'); return snapshot(ref.path); },
          set: (ref, data, options) => writes.push({ ref, data, options }),
        });
        for (const { ref, data, options } of writes) records.set(ref.path, options?.merge ? { ...(records.get(ref.path) || {}), ...data } : data);
        return result;
      };
      const result = tail.then(execute);
      tail = result.catch(() => {});
      return result;
    },
  };
  const auth = {
    verifyIdToken: async (token) => token === 'manager-token' ? { uid: 'manager-1', role: 'manager', manager: true } : Promise.reject(new Error('bad token')),
    getUser: async () => ({ uid: 'manager-1', disabled: false }),
  };
  const storageCalls = [];
  const avatarStorage = {
    async uploadAvatar(uid) {
      storageCalls.push(['upload', uid]);
      return { profilePhotoUrl: 'https://example.supabase.co/storage/v1/object/public/user-avatars/avatars/manager-1/new.png', profilePhotoPath: 'avatars/manager-1/new.png' };
    },
    async deleteAvatar(path, uid) { storageCalls.push(['delete', path, uid]); },
  };
  return { records, storageCalls, avatarStorage, getAdmin: () => ({ auth, db }) };
}

function expected(f) {
  const profile = safeManagerProfile('manager-1', f.records.get('users/manager-1'));
  return { fullName: profile.fullName, phone: profile.phone, address: profile.address, profilePhotoPath: profile.profilePhotoPath };
}

function response() {
  return { statusCode: 200, body: null, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } };
}

async function call(handler, method, body = undefined) {
  const res = response();
  await handler({ method, headers: { authorization: 'Bearer manager-token' }, body }, res);
  return res;
}

const png = fs.readFileSync(path.resolve(__dirname, '../../../assets/icons/home.png'));
const imageUpload = { contentType: 'image/png', dataBase64: png.toString('base64'), fileName: 'avatar.png' };

test('Manager profile GET assigns a canonical Man public UID without exposing a raw Firebase UID', async () => {
  const f = fixture({ unique_id: 'firebase-auth-uid-value-123456789' });
  const result = await call(createManagerProfileHandler(f.getAdmin, { avatarStorage: f.avatarStorage }), 'GET');
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.profile.publicUid, 'Man001');
  assert.equal(f.records.get('users/manager-1').publicUid, 'Man001');
  assert.doesNotMatch(JSON.stringify(result.body.profile), /firebase-auth-uid-value/);
});

test('legacy Mgr public UIDs preserve their number and migrate to Man', async () => {
  const f = fixture({ publicUid: 'Mgr009' });
  const result = await call(createManagerProfileHandler(f.getAdmin, { avatarStorage: f.avatarStorage }), 'GET');
  assert.equal(result.body.profile.publicUid, 'Man009');
  assert.equal(f.records.get('users/manager-1').displayUid, 'Man009');
});

test('Manager can update only own normalized personal fields', async () => {
  const f = fixture({ publicUid: 'Man004' });
  const result = await call(createManagerProfileHandler(f.getAdmin, { avatarStorage: f.avatarStorage }), 'PATCH', {
    fullName: 'Maria Manager', phone: '0917 123 4567', address: 'North Main Street', expectedProfile: expected(f),
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.profile.fullName, 'Maria Manager');
  assert.equal(result.body.profile.phone, '+639171234567');
  assert.equal(result.body.profile.address, 'North Main Street');
  assert.equal(f.records.get('users/manager-1').branchId, 'north');
});

test('Manager profile PATCH rejects an edit after the baseline changes', async () => {
  const f = fixture({ publicUid: 'Man004', phone: '+639171234567', address: 'Original Road' });
  const handler = createManagerProfileHandler(f.getAdmin, { avatarStorage: f.avatarStorage });
  const checked = await call(handler, 'GET');
  assert.equal(checked.body.profile.address, 'Original Road');
  const baseline = expected(f);
  f.records.set('users/manager-1', { ...f.records.get('users/manager-1'), address: 'Concurrent Road' });
  const result = await call(handler, 'PATCH', { fullName: 'Manager One', phone: '+639171234567', address: 'My Road', expectedProfile: baseline });
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.error.reason, 'PROFILE_CONFLICT');
  assert.equal(f.records.get('users/manager-1').address, 'Concurrent Road');
});

test('two concurrent profile updates from one baseline yield one success and one conflict', async () => {
  const f = fixture({ publicUid: 'Man004', phone: '+639171234567', address: 'Original Road' });
  const handler = createManagerProfileHandler(f.getAdmin, { avatarStorage: f.avatarStorage });
  const baseline = expected(f);
  const results = await Promise.all([
    call(handler, 'PATCH', { address: 'First Road', expectedProfile: baseline }),
    call(handler, 'PATCH', { address: 'Second Road', expectedProfile: baseline }),
  ]);
  assert.deepEqual(results.map((result) => result.statusCode).sort(), [200, 409]);
  assert.ok(['First Road', 'Second Road'].includes(f.records.get('users/manager-1').address));
});

test('profile PATCH rejects missing baselines and unauthenticated requests', async () => {
  const f = fixture({ publicUid: 'Man004' });
  const handler = createManagerProfileHandler(f.getAdmin, { avatarStorage: f.avatarStorage });
  assert.equal((await call(handler, 'PATCH', { address: 'New Road' })).body.error.reason, 'PROFILE_BASELINE_REQUIRED');
  const res = response();
  await handler({ method: 'PATCH', headers: {}, body: { address: 'New Road', expectedProfile: expected(f) } }, res);
  assert.equal(res.statusCode, 401);
});

test('manager avatar endpoint rejects client-selected accounts and non-manager tokens', async () => {
  const f = fixture({ publicUid: 'Man004' });
  const handler = createManagerProfileHandler(f.getAdmin, { avatarStorage: f.avatarStorage });
  const attempt = await call(handler, 'PATCH', { uid: 'other-manager', removeImage: true, expectedProfile: expected(f) });
  assert.equal(attempt.statusCode, 400);
  assert.equal(attempt.body.error.reason, 'PROFILE_FIELDS_NOT_ALLOWED');
  assert.deepEqual(f.storageCalls, []);
  for (const role of ['requester', 'distributor', 'admin']) {
    f.records.set('users/manager-1', { ...f.records.get('users/manager-1'), role });
    const denied = await call(handler, 'PATCH', { removeImage: true, expectedProfile: expected(f) });
    assert.equal(denied.statusCode, 403);
    assert.deepEqual(f.storageCalls, []);
  }
});

test('profile transaction rechecks Manager branch and account state before writing', async () => {
  for (const change of [
    { branchId: 'other' }, { managerStatus: 'inactive' }, { mustChangePassword: true }, { role: 'requester' },
  ]) {
    const f = fixture({ publicUid: 'Man004', address: 'Original Road' });
    const baseline = expected(f);
    const avatarStorage = {
      uploadAvatar: async () => {
        f.records.set('users/manager-1', { ...f.records.get('users/manager-1'), ...change });
        return { profilePhotoUrl: 'https://example.test/new.png', profilePhotoPath: 'avatars/manager-1/new.png' };
      },
      deleteAvatar: async () => {},
    };
    const result = await call(createManagerProfileHandler(f.getAdmin, { avatarStorage }), 'PATCH', { address: 'New Road', imageUpload, expectedProfile: baseline });
    assert.equal(result.statusCode, 403);
    assert.equal(f.records.get('users/manager-1').address, 'Original Road');
  }
});

test('Manager Settings retains the draft and exposes backend conflicts and errors', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../../app/manager/settings.jsx'), 'utf8');
  const helpers = source.slice(source.indexOf('const clean ='), source.indexOf('function ProfileField'));
  const saveSource = source.slice(source.indexOf('  async function saveProfile()'), source.indexOf('\n  const themeOptions ='));
  const baseline = { fullName: 'Manager One', phone: '+639171234567', address: 'Original Road' };
  for (const [errorText, status] of [['Your profile changed elsewhere.', 409], ['Manager profile is temporarily unavailable.', 500]]) {
  let writes = 0;
  let editing = true;
  let message = '';
  const bindings = {
    draft: { ...baseline, address: 'My Road' }, editBaseline: { current: baseline },
    expectedProfile: { current: { ...baseline, profilePhotoPath: '' } },
    saveInFlight: { current: false }, isValidManagerPhone: () => true, normalizePhilippinePhone: (value) => value,
    changedProfileFields: require('../../../services/profileDraftComparison').changedProfileFields,
    updateManagerProfile: async () => { writes++; throw Object.assign(new Error(errorText), { status }); }, selectedImage: null, removeImage: false,
    setSaving: () => {}, realtime: { primeProfile: () => {} }, saveLocalUser: () => {},
    setEditing: (value) => { editing = value; }, setSelectedImage: () => {}, showToast: (value) => { message = value; }, setProfileSaveError: () => {},
  };
  const save = new Function(...Object.keys(bindings), `${helpers}\n${saveSource}\nreturn saveProfile;`)(...Object.values(bindings));
  assert.equal(await save(), false);
  assert.equal(writes, 1);
  assert.equal(editing, true);
  assert.equal(message, errorText);
  }
});

test('Manager Settings saves the selected image with the profile and retains it on storage failure', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../../app/manager/settings.jsx'), 'utf8');
  const helpers = source.slice(source.indexOf('const clean ='), source.indexOf('function ProfileField'));
  const saveSource = source.slice(source.indexOf('  async function saveProfile()'), source.indexOf('\n  const themeOptions ='));
  for (const mode of ['success', 'storage-failure', 'cleanup-incomplete']) {
    const image = { uri: 'local-preview' };
    let selected = image;
    let editing = true;
    let sent = null;
    const bindings = {
      draft: { fullName: 'Manager One', phone: '+639171234567', address: 'Road' },
      expectedProfile: { current: { fullName: 'Manager One', phone: '+639171234567', address: 'Road', profilePhotoPath: '' } },
      saveInFlight: { current: false }, isValidManagerPhone: () => true, normalizePhilippinePhone: (value) => value,
      changedProfileFields: require('../../../services/profileDraftComparison').changedProfileFields,
      selectedImage: image, removeImage: false,
      updateManagerProfile: async (...args) => { sent = args; if (mode === 'storage-failure') throw new Error('Storage unavailable'); return { fullName: 'Manager One', photoCleanupIncomplete: mode === 'cleanup-incomplete' }; },
      setSaving: () => {}, setProfileSaveError: () => {}, realtime: { primeProfile: () => {} }, saveLocalUser: () => {},
      setEditing: (value) => { editing = value; }, setSelectedImage: (value) => { selected = value; }, setRemoveImage: () => {}, showToast: () => {},
    };
    const save = new Function(...Object.keys(bindings), `${helpers}\n${saveSource}\nreturn saveProfile;`)(...Object.values(bindings));
    assert.equal(await save(), mode === 'success');
    assert.deepEqual(sent[0], {});
    assert.equal(sent[1], image);
    assert.equal(editing, mode === 'storage-failure');
    assert.equal(selected, mode === 'storage-failure' ? image : null);
  }
});

test('Manager mobile validation accepts exact local and international numbers and rejects pasted excess', async () => {
  for (const phone of ['09171234567', '+639171234567', '0917 123 4567', '+63 917 123 4567']) {
    assert.equal(isValidManagerPhone(phone), true, phone);
    assert.equal(validateProfileChanges({ phone }).phone, '+639171234567');
  }
  for (const phone of ['', '0917123456', '091712345678', '+6391712345678', '08171234567',
    '639171234567', '9171234567', '09171234567abc', '09171234567\n123', '+63917+1234567']) {
    assert.equal(isValidManagerPhone(phone), false, phone);
    assert.throws(() => validateProfileChanges({ phone }), (error) => error.reason === 'INVALID_PHONE');
  }
  // Omission is permitted by the PATCH API; a supplied blank is not.
  assert.deepEqual(validateProfileChanges({ address: 'New address' }), { address: 'New address' });
});

test('invalid Manager phone changes never overwrite the legacy profile or upload a photo', async () => {
  const original = { publicUid: 'Man004', phone: 'legacy number', contactNumber: 'legacy number', address: 'Old address' };
  const f = fixture(original);
  const before = structuredClone(f.records.get('users/manager-1'));
  const handler = createManagerProfileHandler(f.getAdmin, { avatarStorage: f.avatarStorage });
  const invalid = await call(handler, 'PATCH', { phone: '091712345678', fullName: 'Changed Name', address: 'New address', imageUpload });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error.reason, 'INVALID_PHONE');
  assert.deepEqual(f.records.get('users/manager-1'), before);
  assert.deepEqual(f.storageCalls, []);
  const updateWithoutPhone = await call(handler, 'PATCH', { address: 'New address', expectedProfile: expected(f) });
  assert.equal(updateWithoutPhone.statusCode, 200);
  assert.equal(f.records.get('users/manager-1').phone, 'legacy number');
});

test('Manager profile rejects role, branch, public UID, and status mutation fields', () => {
  for (const field of ['role', 'branchId', 'requestedBranchId', 'publicUid', 'managerStatus', 'status', 'accessLevel']) {
    assert.throws(() => validateProfileChanges({ [field]: 'changed' }), (error) => error.reason === 'PROFILE_FIELDS_NOT_ALLOWED');
  }
});

test('valid avatar metadata persists and replaces the old object after Firestore succeeds', async () => {
  const f = fixture({ publicUid: 'Man005', profilePhotoPath: 'avatars/manager-1/old.png' });
  const result = await call(createManagerProfileHandler(f.getAdmin, { avatarStorage: f.avatarStorage }), 'PATCH', { imageUpload, expectedProfile: expected(f) });
  assert.equal(result.statusCode, 200);
  assert.match(result.body.profile.profilePhotoUrl, /user-avatars/);
  assert.deepEqual(f.storageCalls.map((callItem) => callItem[0]), ['upload', 'delete']);
});

test('removing a Manager photo commits before deleting its owned storage path and preserves legacy fields', async () => {
  const f = fixture({ publicUid: 'Man005', profilePhotoUrl: 'https://example.test/old', profilePhotoPath: 'avatars/manager-1/old.png', photoURL: 'https://example.test/legacy' });
  let clearedBeforeDelete = false;
  const storage = { ...f.avatarStorage, deleteAvatar: async (path, uid) => {
    assert.equal(uid, 'manager-1');
    assert.equal(path, 'avatars/manager-1/old.png');
    clearedBeforeDelete = f.records.get('users/manager-1').profilePhotoPath === '';
  } };
  const result = await call(createManagerProfileHandler(f.getAdmin, { avatarStorage: storage }), 'PATCH', { removeImage: true, expectedProfile: expected(f) });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.profile.profilePhotoRemoved, true);
  assert.equal(result.body.profile.profilePhotoUrl, '');
  assert.equal(clearedBeforeDelete, true);
  assert.equal(f.records.get('users/manager-1').photoURL, 'https://example.test/legacy');
});

test('cleanup failures are reported after the profile update without deleting legacy references', async () => {
  const f = fixture({ publicUid: 'Man005', profilePhotoUrl: 'https://example.test/old', profilePhotoPath: 'avatars-v2/u_bWFuYWdlci0x/old.png', photoURL: 'https://example.test/legacy' });
  const storage = { deleteAvatar: async () => { throw new Error('storage offline'); } };
  const result = await call(createManagerProfileHandler(f.getAdmin, { avatarStorage: storage }), 'PATCH', { removeImage: true, expectedProfile: expected(f) });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.profile.photoCleanupIncomplete, true);
  assert.equal(result.body.profile.profilePhotoRemoved, true);
  assert.equal(f.records.get('users/manager-1').photoURL, 'https://example.test/legacy');
});

test('stale removal never deletes the stored image and conflicting image actions are rejected', async () => {
  const f = fixture({ publicUid: 'Man005', profilePhotoPath: 'avatars/manager-1/old.png' });
  const baseline = expected(f);
  f.records.set('users/manager-1', { ...f.records.get('users/manager-1'), profilePhotoPath: 'avatars/manager-1/newer.png' });
  const handler = createManagerProfileHandler(f.getAdmin, { avatarStorage: f.avatarStorage });
  assert.equal((await call(handler, 'PATCH', { removeImage: true, expectedProfile: baseline })).statusCode, 409);
  assert.deepEqual(f.storageCalls, []);
  assert.equal((await call(handler, 'PATCH', { removeImage: true, imageUpload, expectedProfile: expected(f) })).statusCode, 400);
});

test('a lost commit response never deletes a newly referenced Manager image', async () => {
  const f = fixture({ publicUid: 'Man005', profilePhotoPath: 'avatars/manager-1/old.png' });
  const db = f.getAdmin().db;
  const run = db.runTransaction;
  db.runTransaction = async (callback) => { await run(callback); throw new Error('response lost'); };
  const result = await call(createManagerProfileHandler(f.getAdmin, { avatarStorage: f.avatarStorage }), 'PATCH', { imageUpload, expectedProfile: expected(f) });
  assert.equal(result.statusCode, 500);
  assert.equal(f.records.get('users/manager-1').profilePhotoPath, 'avatars/manager-1/new.png');
  assert.deepEqual(f.storageCalls.map((entry) => entry[0]), ['upload']);
});

test('a saved Manager photo is returned by the authorized profile read after reopening', async () => {
  const f = fixture({ publicUid: 'Man007', displayUid: 'Man007' });
  const handler = createManagerProfileHandler(f.getAdmin, { avatarStorage: f.avatarStorage });
  const saved = await call(handler, 'PATCH', { imageUpload, expectedProfile: expected(f) });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.body.profile.profilePhotoUrl, 'https://example.supabase.co/storage/v1/object/public/user-avatars/avatars/manager-1/new.png');

  const reopened = await call(handler, 'GET');
  assert.equal(reopened.statusCode, 200);
  assert.equal(reopened.body.profile.profilePhotoUrl, saved.body.profile.profilePhotoUrl);
  assert.equal(reopened.body.profile.profilePhotoPath, saved.body.profile.profilePhotoPath);
});

test('a rejected profile write cleans the unreferenced new image and preserves the old image', async () => {
  const f = fixture({ publicUid: 'Man005', profilePhotoPath: 'avatars/manager-1/old.png', profilePhotoUrl: 'https://example.test/old.png' });
  f.getAdmin().db.runTransaction = async () => { throw new Error('write failed'); };
  const result = await call(createManagerProfileHandler(f.getAdmin, { avatarStorage: f.avatarStorage }), 'PATCH', { imageUpload, expectedProfile: expected(f) });
  assert.equal(result.statusCode, 500);
  assert.equal(f.records.get('users/manager-1').profilePhotoPath, 'avatars/manager-1/old.png');
  assert.deepEqual(f.storageCalls, [['upload', 'manager-1'], ['delete', 'avatars/manager-1/new.png', 'manager-1']]);
});

test('invalid avatar bytes are rejected and an upload failure preserves the old picture', async () => {
  await assert.rejects(decodeAvatarImage({ contentType: 'image/png', dataBase64: Buffer.from('not png').toString('base64') }), (error) => error.reason === 'PROFILE_IMAGE_TYPE_INVALID');
  await assert.rejects(decodeAvatarImage({ contentType: 'image/png', dataBase64: Buffer.from('89504e470d0a1a0a00000000', 'hex').toString('base64') }), (error) => error.reason === 'PROFILE_IMAGE_TYPE_INVALID');
  await assert.rejects(decodeAvatarImage({ contentType: 'image/png', dataBase64: 'A'.repeat(4 * 1024 * 1024 + 4) }), (error) => error.reason === 'PROFILE_IMAGE_TOO_LARGE');
  const oldUrl = 'https://example.test/old.png';
  const f = fixture({ publicUid: 'Man006', profilePhotoUrl: oldUrl, profilePhotoPath: 'avatars/manager-1/old.png' });
  const failingStorage = { uploadAvatar: async () => { throw new Error('provider failed'); }, deleteAvatar: async () => {} };
  const result = await call(createManagerProfileHandler(f.getAdmin, { avatarStorage: failingStorage }), 'PATCH', { imageUpload, expectedProfile: expected(f) });
  assert.equal(result.statusCode, 500);
  assert.equal(f.records.get('users/manager-1').profilePhotoUrl, oldUrl);
  assert.doesNotMatch(JSON.stringify(result.body), /provider failed/);
});

test('avatar validator decodes JPEG, PNG and WebP and rejects truncated payloads with valid signatures', async () => {
  for (const [format, contentType] of [['jpeg', 'image/jpeg'], ['png', 'image/png'], ['webp', 'image/webp']]) {
    const image = await sharp({ create: { width: 3, height: 3, channels: 3, background: '#1680cd' } }).toFormat(format).toBuffer();
    const valid = await decodeAvatarImage({ contentType, dataBase64: image.toString('base64') });
    assert.equal((await sharp(valid.bytes).metadata()).format, format);
    await assert.rejects(decodeAvatarImage({ contentType, dataBase64: image.subarray(0, 12).toString('base64') }), (error) => error.reason === 'PROFILE_IMAGE_TYPE_INVALID');
  }
});

test('safe Manager profile omits privileged and internal fields', () => {
  const profile = safeManagerProfile('manager-1', { role: 'admin', branchId: 'north', publicUid: 'Man010', password: 'secret', customClaims: { admin: true } });
  assert.equal(profile.role, 'manager');
  assert.equal(profile.publicUid, 'Man010');
  assert.equal(profile.password, undefined);
  assert.equal(profile.customClaims, undefined);
});
