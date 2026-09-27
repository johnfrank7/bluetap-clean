const { randomUUID } = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

const { OtpError } = require('../utils/otpError');

const MAX_AVATAR_BYTES = 3 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const storageError = (reason, message, status = 502) => new OtpError(status, reason, message);

function imageTypeFor(bytes) {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (bytes.subarray(0, 4).equals(Buffer.from('RIFF')) && bytes.subarray(8, 12).equals(Buffer.from('WEBP'))) return 'image/webp';
  return null;
}

function decodeAvatarImage(value) {
  if (!value || typeof value !== 'object') return null;
  const contentType = String(value.contentType || '').toLowerCase().trim();
  const encoded = String(value.dataBase64 || '');
  if (!IMAGE_TYPES.has(contentType)) throw storageError('PROFILE_IMAGE_TYPE_INVALID', 'Use a JPG, PNG, or WebP profile picture.', 422);
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw storageError('PROFILE_IMAGE_TYPE_INVALID', 'Use a valid JPG, PNG, or WebP profile picture.', 400);
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.toString('base64') !== encoded || imageTypeFor(bytes) !== contentType) {
    throw storageError('PROFILE_IMAGE_TYPE_INVALID', 'The selected file does not match its image type.', 422);
  }
  if (bytes.length > MAX_AVATAR_BYTES) throw storageError('PROFILE_IMAGE_TOO_LARGE', 'Profile pictures must be 3 MB or smaller.', 413);
  return { bytes, contentType };
}

function avatarStorageConfigStatus(env = process.env) {
  return {
    url: String(env.SUPABASE_URL || '').trim() ? 'present' : 'missing',
    serviceRoleKey: String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim() ? 'present' : 'missing',
    bucket: String(env.SUPABASE_AVATAR_BUCKET || '').trim() ? 'present' : 'missing',
  };
}

function createSupabaseAvatarStorage({ env = process.env, createClientImpl = createClient } = {}) {
  let client;
  let config;
  let bucketReady;
  const configured = () => {
    if (!config) {
      const url = String(env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
      const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
      const bucket = String(env.SUPABASE_AVATAR_BUCKET || '').trim();
      if (!url.startsWith('https://') || !serviceRoleKey || !/^[a-z0-9][a-z0-9_-]{0,62}$/i.test(bucket)) {
        throw storageError('PROFILE_IMAGE_STORAGE_UNAVAILABLE', 'Profile picture storage is not configured.', 503);
      }
      config = { url, serviceRoleKey, bucket };
      client = createClientImpl(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    }
    return config;
  };
  const ensureBucket = async () => {
    if (!bucketReady) {
      bucketReady = (async () => {
        const { bucket } = configured();
        const { data, error } = await client.storage.getBucket(bucket);
        if (error || !data) throw storageError('PROFILE_IMAGE_BUCKET_NOT_FOUND', 'The profile picture bucket is unavailable.', 503);
        if (data.public !== true) throw storageError('PROFILE_IMAGE_BUCKET_NOT_PUBLIC', 'The profile picture bucket must allow public reads.', 503);
        return config;
      })().catch((error) => { bucketReady = null; throw error; });
    }
    return bucketReady;
  };
  return {
    async uploadAvatar(uid, image) {
      const safeUid = String(uid || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
      if (!safeUid) throw storageError('AUTHENTICATION_REQUIRED', 'Authentication is required.', 401);
      const extension = image.contentType === 'image/jpeg' ? 'jpg' : image.contentType.split('/')[1];
      const profilePhotoPath = `avatars/${safeUid}/${randomUUID()}.${extension}`;
      const { bucket } = await ensureBucket();
      const { error } = await client.storage.from(bucket).upload(profilePhotoPath, image.bytes, {
        contentType: image.contentType,
        cacheControl: '31536000',
        upsert: false,
      });
      if (error) throw storageError('PROFILE_IMAGE_UPLOAD_FAILED', 'Profile picture upload could not finish. Please try again.');
      const { data } = client.storage.from(bucket).getPublicUrl(profilePhotoPath);
      const expectedPath = `/storage/v1/object/public/${encodeURIComponent(bucket)}/`;
      if (!data?.publicUrl || !String(data.publicUrl).includes(expectedPath)) {
        await client.storage.from(bucket).remove([profilePhotoPath]).catch(() => {});
        throw storageError('PROFILE_IMAGE_PUBLIC_URL_FAILED', 'The profile picture URL could not be created.');
      }
      return { profilePhotoUrl: data.publicUrl, profilePhotoPath };
    },
    async deleteAvatar(path, uid) {
      const safeUid = String(uid || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
      const safePath = String(path || '');
      if (!safeUid || !new RegExp(`^avatars/${safeUid}/[a-zA-Z0-9-]+\\.(jpg|png|webp)$`).test(safePath)) return;
      const { bucket } = await ensureBucket();
      const { error } = await client.storage.from(bucket).remove([safePath]);
      if (error) throw storageError('PROFILE_IMAGE_DELETE_FAILED', 'The previous profile picture could not be removed.');
    },
  };
}

module.exports = { MAX_AVATAR_BYTES, avatarStorageConfigStatus, createSupabaseAvatarStorage, decodeAvatarImage, imageTypeFor };
