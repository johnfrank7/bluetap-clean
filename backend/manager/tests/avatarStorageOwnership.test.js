const test = require('node:test');
const assert = require('node:assert/strict');
const { createSupabaseAvatarStorage } = require('../../services/supabaseAvatarStorage');

test('avatar paths distinguish Firebase UIDs and deletion remains scoped to their owner', async () => {
  const deleted = [];
  const uploaded = [];
  const bucket = {
    upload: async (path) => { uploaded.push(path); return { error: null }; },
    getPublicUrl: (path) => ({ data: { publicUrl: `https://example.test/storage/v1/object/public/avatars/${path}` } }),
    remove: async (paths) => { deleted.push(...paths); return { error: null }; },
  };
  const storage = createSupabaseAvatarStorage({
    env: { SUPABASE_URL: 'https://example.test', SUPABASE_SERVICE_ROLE_KEY: 'test-only-key', SUPABASE_AVATAR_BUCKET: 'avatars' },
    createClientImpl: () => ({ storage: { getBucket: async () => ({ data: { public: true } }), from: () => bucket } }),
  });
  const image = { bytes: Buffer.from('test'), contentType: 'image/png' };
  const a = await storage.uploadAvatar('a.b', image);
  const b = await storage.uploadAvatar('ab', image);
  assert.notEqual(a.profilePhotoPath.split('/')[1], b.profilePhotoPath.split('/')[1]);
  await storage.deleteAvatar(a.profilePhotoPath, 'ab');
  await storage.deleteAvatar('avatars/ab/old.png', 'a.b');
  await storage.deleteAvatar('avatars/ab/old.png', 'ab');
  await storage.deleteAvatar(`avatars/${a.profilePhotoPath.split('/')[1]}/old.png`, 'a.b');
  assert.deepEqual(deleted, []);
  await storage.deleteAvatar(a.profilePhotoPath, 'a.b');
  await storage.deleteAvatar(b.profilePhotoPath, 'ab');
  assert.deepEqual(deleted, [a.profilePhotoPath, b.profilePhotoPath]);
  assert.equal(uploaded.length, 2);
});
