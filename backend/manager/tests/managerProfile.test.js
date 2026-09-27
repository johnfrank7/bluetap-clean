const assert = require('node:assert/strict');
const test = require('node:test');

const { createManagerProfileHandler, safeManagerProfile, validateProfileChanges } = require('../profileHandler');
const { decodeAvatarImage } = require('../../services/supabaseAvatarStorage');

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
  const db = {
    collection,
    runTransaction: async (run) => run({
      get: async (ref) => snapshot(ref.path),
      set(ref, data, options) { records.set(ref.path, options?.merge ? { ...(records.get(ref.path) || {}), ...data } : data); },
    }),
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

function response() {
  return { statusCode: 200, body: null, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } };
}

async function call(handler, method, body = undefined) {
  const res = response();
  await handler({ method, headers: { authorization: 'Bearer manager-token' }, body }, res);
  return res;
}

const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
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
    fullName: 'Maria Manager', phone: '0917 123 4567', address: 'North Main Street',
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.profile.fullName, 'Maria Manager');
  assert.equal(result.body.profile.phone, '+639171234567');
  assert.equal(result.body.profile.address, 'North Main Street');
  assert.equal(f.records.get('users/manager-1').branchId, 'north');
});

test('Manager profile rejects role, branch, public UID, and status mutation fields', () => {
  for (const field of ['role', 'branchId', 'requestedBranchId', 'publicUid', 'managerStatus', 'status', 'accessLevel']) {
    assert.throws(() => validateProfileChanges({ [field]: 'changed' }), (error) => error.reason === 'PROFILE_FIELDS_NOT_ALLOWED');
  }
});

test('valid avatar metadata persists and replaces the old object after Firestore succeeds', async () => {
  const f = fixture({ publicUid: 'Man005', profilePhotoPath: 'avatars/manager-1/old.png' });
  const result = await call(createManagerProfileHandler(f.getAdmin, { avatarStorage: f.avatarStorage }), 'PATCH', { imageUpload });
  assert.equal(result.statusCode, 200);
  assert.match(result.body.profile.profilePhotoUrl, /user-avatars/);
  assert.deepEqual(f.storageCalls.map((callItem) => callItem[0]), ['upload', 'delete']);
});

test('invalid avatar bytes are rejected and an upload failure preserves the old picture', async () => {
  assert.throws(() => decodeAvatarImage({ contentType: 'image/png', dataBase64: Buffer.from('not png').toString('base64') }), (error) => error.reason === 'PROFILE_IMAGE_TYPE_INVALID');
  const oldUrl = 'https://example.test/old.png';
  const f = fixture({ publicUid: 'Man006', profilePhotoUrl: oldUrl, profilePhotoPath: 'avatars/manager-1/old.png' });
  const failingStorage = { uploadAvatar: async () => { throw new Error('provider failed'); }, deleteAvatar: async () => {} };
  const result = await call(createManagerProfileHandler(f.getAdmin, { avatarStorage: failingStorage }), 'PATCH', { imageUpload });
  assert.equal(result.statusCode, 500);
  assert.equal(f.records.get('users/manager-1').profilePhotoUrl, oldUrl);
  assert.doesNotMatch(JSON.stringify(result.body), /provider failed/);
});

test('safe Manager profile omits privileged and internal fields', () => {
  const profile = safeManagerProfile('manager-1', { role: 'admin', branchId: 'north', publicUid: 'Man010', password: 'secret', customClaims: { admin: true } });
  assert.equal(profile.role, 'manager');
  assert.equal(profile.publicUid, 'Man010');
  assert.equal(profile.password, undefined);
  assert.equal(profile.customClaims, undefined);
});
