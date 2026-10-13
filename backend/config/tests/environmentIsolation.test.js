const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getAppEnv,
  isKnownProductionFirebaseProject,
  isKnownProductionBackendHost,
  isKnownProductionDeepFaceHost,
  isKnownProductionMailRelay,
  APP_ENVIRONMENTS,
} = require('../appEnv');
const { checkServerEnvironment, validateServerEnvironment } = require('../serverEnvironment');
const { isAllowedOrigin } = require('../../utils/cors');
const { verifyDeployTarget } = require('../../../scripts/verify-deploy-target');

test('Environment selection: getAppEnv correctly prioritizes APP_ENV and EXPO_PUBLIC_APP_ENV', () => {
  assert.equal(getAppEnv({ APP_ENV: 'staging' }), APP_ENVIRONMENTS.STAGING);
  assert.equal(getAppEnv({ EXPO_PUBLIC_APP_ENV: 'staging' }), APP_ENVIRONMENTS.STAGING);
  assert.equal(getAppEnv({ APP_ENV: 'production' }), APP_ENVIRONMENTS.PRODUCTION);
  assert.equal(getAppEnv({ EXPO_PUBLIC_APP_ENV: 'production' }), APP_ENVIRONMENTS.PRODUCTION);
  assert.equal(getAppEnv({ APP_ENV: 'development' }), APP_ENVIRONMENTS.DEVELOPMENT);
  assert.equal(getAppEnv({ APP_ENV: 'test' }), APP_ENVIRONMENTS.DEVELOPMENT);

  // Even if NODE_ENV=production, explicit APP_ENV=staging yields staging
  assert.equal(getAppEnv({ NODE_ENV: 'production', APP_ENV: 'staging' }), APP_ENVIRONMENTS.STAGING);

  // Fallback to NODE_ENV=production when APP_ENV is unset
  assert.equal(getAppEnv({ NODE_ENV: 'production' }), APP_ENVIRONMENTS.PRODUCTION);
  assert.equal(getAppEnv({ NODE_ENV: 'development' }), APP_ENVIRONMENTS.DEVELOPMENT);
  assert.equal(getAppEnv({}), APP_ENVIRONMENTS.DEVELOPMENT);
});

test('Production resource detection accurately flags known endpoints', () => {
  assert.equal(isKnownProductionFirebaseProject('bluetap-8c98d'), true);
  assert.equal(isKnownProductionFirebaseProject('BLUETAP-8C98D'), true);
  assert.equal(isKnownProductionFirebaseProject('bluetap-staging'), false);

  assert.equal(isKnownProductionBackendHost('https://bluetap-clean.onrender.com'), true);
  assert.equal(isKnownProductionBackendHost('bluetap-clean.onrender.com'), true);
  assert.equal(isKnownProductionBackendHost('https://bluetap-staging.onrender.com'), false);

  assert.equal(isKnownProductionDeepFaceHost('https://bluetap-face-api.onrender.com'), true);
  assert.equal(isKnownProductionDeepFaceHost('https://bluetap-staging-face.onrender.com'), false);

  assert.equal(isKnownProductionMailRelay('https://bluetap-beta.vercel.app/api/internal/send-otp-email'), true);
  assert.equal(isKnownProductionMailRelay('https://bluetap-staging.vercel.app/api/internal/send-otp-email'), false);
});

test('Client Firebase web configuration: staging rejects missing config and production project', async () => {
  const { resolveFirebaseWebConfig } = await import('../../../services/firebaseConfig.js');

  // Missing required vars in staging throws
  assert.throws(
    () => resolveFirebaseWebConfig({ EXPO_PUBLIC_APP_ENV: 'staging' }),
    /missing required environment variables/i
  );

  // Staging targeting production project throws security violation
  assert.throws(
    () => resolveFirebaseWebConfig({
      EXPO_PUBLIC_APP_ENV: 'staging',
      EXPO_PUBLIC_FIREBASE_API_KEY: 'staging-key',
      EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'bluetap-8c98d',
    }),
    /Security violation: Staging cannot initialize with production Firebase project/i
  );

  // Staging targeting production project via APP_ENV throws security violation
  assert.throws(
    () => resolveFirebaseWebConfig({
      APP_ENV: 'staging',
      EXPO_PUBLIC_FIREBASE_API_KEY: 'staging-key',
      EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'bluetap-8c98d',
    }),
    /Security violation: Staging cannot initialize with production Firebase project/i
  );

  // Staging with valid non-production project succeeds and defaults storageBucket
  const stagingConfig = resolveFirebaseWebConfig({
    EXPO_PUBLIC_APP_ENV: 'staging',
    EXPO_PUBLIC_FIREBASE_API_KEY: 'staging-key-123',
    EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'bluetap-staging-test',
  });
  assert.equal(stagingConfig.projectId, 'bluetap-staging-test');
  assert.equal(stagingConfig.apiKey, 'staging-key-123');
  assert.equal(stagingConfig.storageBucket, 'bluetap-staging-test.firebasestorage.app');

  // Staging with explicit storageBucket uses the explicit value
  const stagingWithBucket = resolveFirebaseWebConfig({
    EXPO_PUBLIC_APP_ENV: 'staging',
    EXPO_PUBLIC_FIREBASE_API_KEY: 'staging-key-123',
    EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'bluetap-staging-test',
    EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: 'custom-staging-bucket.appspot.com',
  });
  assert.equal(stagingWithBucket.storageBucket, 'custom-staging-bucket.appspot.com');

  // Complete integration of the provided bluetap-staging configuration
  const bluetapStagingConfig = resolveFirebaseWebConfig({
    EXPO_PUBLIC_APP_ENV: 'staging',
    EXPO_PUBLIC_FIREBASE_API_KEY: 'AIzaSyBfuRta5kl-ryk1MNVurafmEJdw2EBv_Qg',
    EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: 'bluetap-staging.firebaseapp.com',
    EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'bluetap-staging',
    EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: 'bluetap-staging.firebasestorage.app',
    EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '452379686635',
    EXPO_PUBLIC_FIREBASE_APP_ID: '1:452379686635:web:e6e8deaa6bc5a03a8a70ae',
    EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID: 'G-VHGJKMVRVV',
  });
  assert.equal(bluetapStagingConfig.apiKey, 'AIzaSyBfuRta5kl-ryk1MNVurafmEJdw2EBv_Qg');
  assert.equal(bluetapStagingConfig.authDomain, 'bluetap-staging.firebaseapp.com');
  assert.equal(bluetapStagingConfig.projectId, 'bluetap-staging');
  assert.equal(bluetapStagingConfig.storageBucket, 'bluetap-staging.firebasestorage.app');
  assert.equal(bluetapStagingConfig.messagingSenderId, '452379686635');
  assert.equal(bluetapStagingConfig.appId, '1:452379686635:web:e6e8deaa6bc5a03a8a70ae');
  assert.equal(bluetapStagingConfig.measurementId, 'G-VHGJKMVRVV');

  // Development with custom project override resolves storageBucket
  const devCustomConfig = resolveFirebaseWebConfig({
    EXPO_PUBLIC_APP_ENV: 'development',
    EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'bluetap-dev-custom',
    EXPO_PUBLIC_FIREBASE_API_KEY: 'dev-custom-key',
  });
  assert.equal(devCustomConfig.projectId, 'bluetap-dev-custom');
  assert.equal(devCustomConfig.storageBucket, 'bluetap-dev-custom.firebasestorage.app');

  // Production returns default production config without requiring env vars
  const prodConfig = resolveFirebaseWebConfig({ EXPO_PUBLIC_APP_ENV: 'production' });
  assert.equal(prodConfig.projectId, 'bluetap-8c98d');

  // Production fallback with unconfigured environment
  const unconfiguredConfig = resolveFirebaseWebConfig({});
  assert.equal(unconfiguredConfig.projectId, 'bluetap-8c98d');
});

test('Client API URL: staging rejects missing backend URL and production backend URLs', async () => {
  const { getApiBaseUrl } = await import('../../../services/apiClientConfig.js');

  // Missing backend URL in staging throws
  assert.throws(
    () => getApiBaseUrl({ EXPO_PUBLIC_APP_ENV: 'staging' }),
    /Staging backend API URL is not configured/i
  );

  // Staging targeting production backend throws security violation
  assert.throws(
    () => getApiBaseUrl({
      EXPO_PUBLIC_APP_ENV: 'staging',
      EXPO_PUBLIC_API_BASE_URL: 'https://bluetap-clean.onrender.com',
    }),
    /Security violation: Staging client cannot connect to production backend URL/i
  );

  // Staging targeting valid staging backend succeeds
  const stagingUrl = getApiBaseUrl({
    EXPO_PUBLIC_APP_ENV: 'staging',
    EXPO_PUBLIC_API_BASE_URL: 'https://bluetap-staging.onrender.com',
  });
  assert.equal(stagingUrl, 'https://bluetap-staging.onrender.com');

  // Production backward compatibility: returns default production URL when unset
  const prodUrl = getApiBaseUrl({ EXPO_PUBLIC_APP_ENV: 'production' });
  assert.equal(prodUrl, 'https://bluetap-clean.onrender.com');

  // Development defaults to localhost:3000
  const devUrl = getApiBaseUrl({ EXPO_PUBLIC_APP_ENV: 'development' });
  assert.equal(devUrl, 'http://localhost:3000');
});

test('Server startup validation: staging fails closed for production project or production services', () => {
  // Staging with production project fails
  const res1 = checkServerEnvironment({
    APP_ENV: 'staging',
    FIREBASE_PROJECT_ID: 'bluetap-8c98d',
  });
  assert.equal(res1.valid, false);
  assert.match(res1.errors.join('; '), /Staging backend cannot target production Firebase project/);

  // Staging with production mail relay fails
  const res2 = checkServerEnvironment({
    APP_ENV: 'staging',
    FIREBASE_PROJECT_ID: 'bluetap-staging',
    EMAIL_PROVIDER: 'vercel-relay',
    VERCEL_MAIL_RELAY_URL: 'https://bluetap-beta.vercel.app/api/internal/send-otp-email',
  });
  assert.equal(res2.valid, false);
  assert.match(res2.errors.join('; '), /Staging backend cannot target production Vercel mail relay/);

  // Staging with production DeepFace API fails
  const res3 = checkServerEnvironment({
    APP_ENV: 'staging',
    FIREBASE_PROJECT_ID: 'bluetap-staging',
    DEEPFACE_API_URL: 'https://bluetap-face-api.onrender.com',
  });
  assert.equal(res3.valid, false);
  assert.match(res3.errors.join('; '), /Staging backend cannot target production DeepFace API/);

  // Staging with production service account fails
  const resSaProd = checkServerEnvironment({
    APP_ENV: 'staging',
    FIREBASE_PROJECT_ID: 'bluetap-staging',
    FIREBASE_CLIENT_EMAIL: 'firebase-adminsdk@bluetap-8c98d.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY: 'mock-key',
  });
  assert.equal(resSaProd.valid, false);
  assert.match(resSaProd.errors.join('; '), /Staging backend cannot use production service account/);

  // Staging with mismatched service account project fails
  const resSaMismatch = checkServerEnvironment({
    APP_ENV: 'staging',
    FIREBASE_PROJECT_ID: 'bluetap-staging',
    FIREBASE_CLIENT_EMAIL: 'firebase-adminsdk@different-project.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY: 'mock-key',
  });
  assert.equal(resSaMismatch.valid, false);
  assert.match(resSaMismatch.errors.join('; '), /Service account project "different-project" does not match FIREBASE_PROJECT_ID "bluetap-staging"/);

  // Production with staging service account fails
  const resProdWithStagingSa = checkServerEnvironment({
    APP_ENV: 'production',
    FIREBASE_PROJECT_ID: 'bluetap-8c98d',
    FIREBASE_CLIENT_EMAIL: 'staging-service@bluetap-staging.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY: 'mock-key',
  });
  assert.equal(resProdWithStagingSa.valid, false);
  assert.match(resProdWithStagingSa.errors.join('; '), /Production backend cannot use staging service account/);

  // Staging with complete valid configuration succeeds
  const resSafe = checkServerEnvironment({
    APP_ENV: 'staging',
    FIREBASE_PROJECT_ID: 'bluetap-staging',
    FIREBASE_CLIENT_EMAIL: 'staging-service@bluetap-staging.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgk...\n-----END PRIVATE KEY-----',
    EMAIL_PROVIDER: 'resend',
    DEEPFACE_API_URL: 'https://bluetap-staging-face.onrender.com',
  });
  assert.equal(resSafe.valid, true);
  assert.equal(resSafe.errors.length, 0);

  // validateServerEnvironment throws on violation
  assert.throws(
    () => validateServerEnvironment({ APP_ENV: 'staging', FIREBASE_PROJECT_ID: 'bluetap-8c98d' }),
    (err) => err.code === 'CONFIG_SECURITY_VIOLATION'
  );
});

test('CORS origin checking: staging does not automatically trust production Vercel origin', () => {
  const req = { headers: {} };
  const prodOrigin = 'https://bluetap-beta.vercel.app';
  const stagingOrigin = 'https://bluetap-staging.vercel.app';

  // In production, production origin is trusted
  assert.equal(isAllowedOrigin(req, prodOrigin, { APP_ENV: 'production' }), true);

  // In staging, production origin is NOT trusted by default
  assert.equal(isAllowedOrigin(req, prodOrigin, { APP_ENV: 'staging' }), false);

  // In staging, origin listed in ALLOWED_ORIGINS is allowed
  assert.equal(
    isAllowedOrigin(req, stagingOrigin, {
      APP_ENV: 'staging',
      ALLOWED_ORIGINS: 'https://bluetap-staging.vercel.app,http://localhost:19006',
    }),
    true
  );
});

test('CLI deployment safety helper: rejects missing project and accidental production targets', () => {
  // Missing environment throws
  assert.throws(() => verifyDeployTarget({}), /Target environment is required/);

  // Staging missing project throws
  assert.throws(() => verifyDeployTarget({ env: 'staging' }), /Explicit project ID is required for staging/);

  // Staging with production project throws critical error
  assert.throws(
    () => verifyDeployTarget({ env: 'staging', project: 'bluetap-8c98d' }),
    /Staging operations cannot target production Firebase project/
  );

  // Staging with valid staging project passes
  const stagingTarget = verifyDeployTarget({ env: 'staging', project: 'bluetap-staging' });
  assert.equal(stagingTarget.safe, true);
  assert.equal(stagingTarget.project, 'bluetap-staging');

  // Production with wrong project throws
  assert.throws(
    () => verifyDeployTarget({ env: 'production', project: 'wrong-project' }),
    /Production deployment requires project "bluetap-8c98d"/
  );

  // Production with bluetap-8c98d passes
  const prodTarget = verifyDeployTarget({ env: 'production', project: 'bluetap-8c98d' });
  assert.equal(prodTarget.safe, true);
  assert.equal(prodTarget.project, 'bluetap-8c98d');
});

test('Username authentication: staging project validation and production rejection', async (t) => {
  const { createUsernameHandler } = require('../../username/usernameHandler');
  const response = () => ({
    statusCode: 200, headers: {}, body: null,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  });

  const fixture = () => {
    const records = new Map();
    records.set('usernames/teststaging', { uid: 'uid-staging-1' });
    records.set('users/uid-staging-1', { role: 'requester', registrationCompleted: true, onboardingStatus: 'complete' });
    return {
      db: {
        collection: (name) => ({
          doc: (id) => ({
            get: async () => ({ exists: records.has(`${name}/${id}`), data: () => records.get(`${name}/${id}`) }),
          }),
        }),
        runTransaction: async (cb) => cb({
          get: async (item) => ({ exists: true, data: () => ({}) }),
          set: () => {},
        }),
      },
      auth: {
        getUser: async (uid) => ({ uid, email: 'test@staging.test', disabled: false }),
        verifyIdToken: async () => ({ uid: 'uid-staging-1' }),
        createCustomToken: async (uid) => `custom-${uid}`,
      },
    };
  };

  // Mock global.fetch for Identity Toolkit verification
  t.mock.method(global, 'fetch', async (url) => {
    if (url.includes('/v1/projects?')) {
      return { ok: true, json: async () => ({ projectId: 'bluetap-staging' }) };
    }
    return {
      ok: true,
      json: async () => ({ localId: 'uid-staging-1', idToken: 'test-staging-token' }),
    };
  });

  const savedEnv = {
    APP_ENV: process.env.APP_ENV,
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
    FIREBASE_WEB_API_KEY: process.env.FIREBASE_WEB_API_KEY,
    FIREBASE_WEB_PROJECT_ID: process.env.FIREBASE_WEB_PROJECT_ID,
    EMAIL_OTP_HASH_SECRET: process.env.EMAIL_OTP_HASH_SECRET,
  };

  process.env.EMAIL_OTP_HASH_SECRET = 'test-hash-secret';

  try {
    // 1. Staging mode with production project fails closed
    process.env.APP_ENV = 'staging';
    process.env.FIREBASE_PROJECT_ID = 'bluetap-8c98d';
    process.env.FIREBASE_WEB_API_KEY = 'any-key';
    const handlerStagingProd = createUsernameHandler('login', fixture);
    const res1 = response();
    await handlerStagingProd({ method: 'POST', headers: {}, body: { username: 'teststaging', password: 'password123' }, socket: { remoteAddress: '127.0.0.1' } }, res1);
    assert.equal(res1.statusCode, 503);

    // 2. Staging mode with staging project and verified staging key succeeds
    process.env.APP_ENV = 'staging';
    process.env.FIREBASE_PROJECT_ID = 'bluetap-staging';
    process.env.FIREBASE_WEB_API_KEY = 'AIzaSyBfuRta5kl-ryk1MNVurafmEJdw2EBv_Qg';
    delete process.env.FIREBASE_WEB_PROJECT_ID;
    const handlerStagingSafe = createUsernameHandler('login', fixture);
    const res2 = response();
    await handlerStagingSafe({ method: 'POST', headers: {}, body: { username: 'teststaging', password: 'password123' }, socket: { remoteAddress: '127.0.0.1' } }, res2);
    assert.equal(res2.statusCode, 200);
    assert.equal(res2.body.customToken, 'custom-uid-staging-1');

    // 3. Project mismatch: web project differs from server project fails closed
    process.env.FIREBASE_WEB_PROJECT_ID = 'different-project';
    const handlerMismatch = createUsernameHandler('login', fixture);
    const res3 = response();
    await handlerMismatch({ method: 'POST', headers: {}, body: { username: 'teststaging', password: 'password123' }, socket: { remoteAddress: '127.0.0.1' } }, res3);
    assert.equal(res3.statusCode, 503);
  } finally {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('OTP relay and DeepFace client reject production URLs in staging mode', async () => {
  const { createEmailProvider } = require('../../email/emailProvider');
  const { createRenderFaceClient, faceUpstreamConfigStatus } = require('../../verification/renderFaceClient');

  // Staging email provider rejects production Vercel relay URL
  const stagingEmail = createEmailProvider({
    env: {
      APP_ENV: 'staging',
      EMAIL_PROVIDER: 'vercel-relay',
      VERCEL_MAIL_RELAY_URL: 'https://bluetap-beta.vercel.app/api/internal/send-otp-email',
      INTERNAL_MAIL_RELAY_SECRET: 'secret',
    },
  });

  await assert.rejects(
    () => stagingEmail.sendEmail({
      to: 'tester@staging.test',
      subject: 'BlueTap Email Verification Code',
      text: 'Code: 123456',
      html: '<p>Code: 123456</p>',
      requestId: '00000000-0000-4000-8000-000000000001',
    }),
    (err) => err.reason === 'EMAIL_TRANSPORT_NOT_CONFIGURED'
  );

  // Staging DeepFace client rejects production DeepFace URL
  const faceConfig = faceUpstreamConfigStatus({
    APP_ENV: 'staging',
    DEEPFACE_API_URL: 'https://bluetap-face-api.onrender.com',
    DEEPFACE_API_KEY: 'test-key',
  });
  assert.equal(faceConfig.urlConfigured, false);

  const stagingFace = createRenderFaceClient({
    env: {
      APP_ENV: 'staging',
      DEEPFACE_API_URL: 'https://bluetap-face-api.onrender.com',
      DEEPFACE_API_KEY: 'test-key',
    },
  });

  await assert.rejects(
    () => stagingFace('/ready', null, null),
    (err) => err.reason === 'FACE_SERVICE_UNAVAILABLE'
  );
});

test('Staging runtime configuration emission cannot bundle production identifiers', async () => {
  const { resolveFirebaseWebConfig } = await import('../../../services/firebaseConfig.js');
  const { getApiBaseUrl } = await import('../../../services/apiClientConfig.js');

  const stagingEnv = {
    EXPO_PUBLIC_APP_ENV: 'staging',
    EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'bluetap-staging-isolated',
    EXPO_PUBLIC_FIREBASE_API_KEY: 'staging-isolated-key',
    EXPO_PUBLIC_API_BASE_URL: 'https://bluetap-staging-api.onrender.com',
  };

  const emittedFirebaseConfig = resolveFirebaseWebConfig(stagingEnv);
  const emittedApiBaseUrl = getApiBaseUrl(stagingEnv);

  // Runtime values MUST NOT be production values
  assert.notEqual(emittedFirebaseConfig.projectId, 'bluetap-8c98d');
  assert.equal(emittedFirebaseConfig.projectId, 'bluetap-staging-isolated');
  assert.notEqual(emittedApiBaseUrl, 'https://bluetap-clean.onrender.com');
  assert.equal(emittedApiBaseUrl, 'https://bluetap-staging-api.onrender.com');

  // Verify that staging runtime fails if someone tries to inject production project
  assert.throws(
    () => resolveFirebaseWebConfig({
      ...stagingEnv,
      EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'bluetap-8c98d',
    }),
    /Security violation: Staging cannot initialize with production Firebase project/
  );

  // Verify that staging runtime fails if someone tries to inject production backend
  assert.throws(
    () => getApiBaseUrl({
      ...stagingEnv,
      EXPO_PUBLIC_API_BASE_URL: 'https://bluetap-clean.onrender.com',
    }),
    /Security violation: Staging client cannot connect to production backend URL/
  );
});

test('Environment selection: rejects invalid or misspelled APP_ENV/EXPO_PUBLIC_APP_ENV and detects conflicting settings', () => {
  // Misspelled APP_ENV throws clear error
  assert.throws(
    () => getAppEnv({ APP_ENV: 'stagin' }),
    /Invalid APP_ENV "stagin"/
  );

  // Misspelled EXPO_PUBLIC_APP_ENV throws clear error
  assert.throws(
    () => getAppEnv({ EXPO_PUBLIC_APP_ENV: 'stage' }),
    /Invalid EXPO_PUBLIC_APP_ENV "stage"/
  );

  // Conflicting environments throw clear error
  assert.throws(
    () => getAppEnv({ APP_ENV: 'staging', EXPO_PUBLIC_APP_ENV: 'production' }),
    /Conflicting environment settings/
  );

  // Server startup validation reports invalid environment safely
  const invalidResult = checkServerEnvironment({ APP_ENV: 'stagin' });
  assert.equal(invalidResult.valid, false);
  assert.match(invalidResult.errors[0], /Invalid APP_ENV/);
});

test('Supabase Storage isolation: staging rejects production Supabase project and supports non-network mock', async () => {
  const { createSupabaseProductImageStorage } = require('../../services/supabaseStorage');
  const { createSupabaseAvatarStorage } = require('../../services/supabaseAvatarStorage');

  // Staging server preflight rejects production Supabase URL
  const prodSupabaseEnv = {
    APP_ENV: 'staging',
    FIREBASE_PROJECT_ID: 'bluetap-staging',
    FIREBASE_CLIENT_EMAIL: 'sa@staging.test',
    FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQD...==\n-----END PRIVATE KEY-----',
    PRODUCTION_SUPABASE_URL: 'https://prod-supabase.supabase.co',
    SUPABASE_URL: 'https://prod-supabase.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'staging-key',
    SUPABASE_STORAGE_BUCKET: 'staging-products',
  };
  const stagingProdResult = checkServerEnvironment(prodSupabaseEnv);
  assert.equal(stagingProdResult.valid, false);
  assert.ok(stagingProdResult.errors.some((e) => e.includes('Staging backend cannot target production Supabase project')));

  // Inconsistent staging Supabase configuration (URL provided, but missing service role key)
  const inconsistentEnv = {
    ...prodSupabaseEnv,
    SUPABASE_URL: 'https://staging-unique.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: '',
  };
  const inconsistentResult = checkServerEnvironment(inconsistentEnv);
  assert.equal(inconsistentResult.valid, false);
  assert.ok(inconsistentResult.errors.some((e) => e.includes('Staging Supabase configuration is inconsistent')));

  // Production forbids mock storage driver
  const prodWithMockResult = checkServerEnvironment({
    APP_ENV: 'production',
    FIREBASE_PROJECT_ID: 'bluetap-8c98d',
    SUPABASE_STORAGE_DRIVER: 'mock',
  });
  assert.equal(prodWithMockResult.valid, false);
  assert.ok(prodWithMockResult.errors.some((e) => e.includes('Staging storage mock is strictly prohibited in production')));

  // Staging mock storage driver runs fully without network calls for products
  const stagingMockProductStorage = createSupabaseProductImageStorage({
    env: {
      APP_ENV: 'staging',
      SUPABASE_STORAGE_DRIVER: 'mock',
      SUPABASE_STORAGE_BUCKET: 'staging-products',
    },
  });

  const validJpgBase64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]).toString('base64');
  const uploadedProduct = await stagingMockProductStorage.uploadProductImage('prod-mock-1', {
    contentType: 'image/jpeg',
    dataBase64: validJpgBase64,
  });
  assert.equal(uploadedProduct.imageStorageProvider, 'supabase');
  assert.match(uploadedProduct.imageUrl, /^https:\/\/staging-mock-storage\.local\/storage\/v1\/object\/public\/staging-products\/products\/prod-mock-1\//);
  await assert.doesNotReject(() => stagingMockProductStorage.deleteProductImage(uploadedProduct.imagePath, 'prod-mock-1'));

  // Staging mock storage driver runs fully without network calls for avatars
  const stagingMockAvatarStorage = createSupabaseAvatarStorage({
    env: {
      APP_ENV: 'staging',
      SUPABASE_STORAGE_DRIVER: 'mock',
      SUPABASE_AVATAR_BUCKET: 'staging-avatars',
    },
  });
  const uploadedAvatar = await stagingMockAvatarStorage.uploadAvatar('mgr-mock-1', {
    contentType: 'image/jpeg',
    dataBase64: validJpgBase64,
  });
  assert.match(uploadedAvatar.profilePhotoUrl, /^https:\/\/staging-mock-storage\.local\/storage\/v1\/object\/public\/staging-avatars\/avatars\/mgr-mock-1\//);
  await assert.doesNotReject(() => stagingMockAvatarStorage.deleteAvatar(uploadedAvatar.profilePhotoPath, 'mgr-mock-1'));

  // In production, createSupabaseProductImageStorage rejects mock driver immediately
  assert.throws(
    () => createSupabaseProductImageStorage({
      env: {
        APP_ENV: 'production',
        SUPABASE_STORAGE_DRIVER: 'mock',
      },
    }),
    /Security violation: Staging storage mock is strictly prohibited in production/
  );
});

test('CLI deployment safety: multi-platform validation for firebase, render, and vercel', () => {
  // Firebase staging rejects production
  assert.throws(
    () => verifyDeployTarget({ env: 'staging', platform: 'firebase', project: 'bluetap-8c98d' }),
    /CRITICAL: Staging operations cannot target production Firebase project/
  );
  assert.equal(
    verifyDeployTarget({ env: 'staging', platform: 'firebase', project: 'bluetap-staging' }).safe,
    true
  );

  // Render staging rejects production services
  assert.throws(
    () => verifyDeployTarget({ env: 'staging', platform: 'render', service: 'bluetap-clean' }),
    /CRITICAL: Staging operations cannot target production Render service/
  );
  assert.throws(
    () => verifyDeployTarget({ env: 'staging', platform: 'render', service: 'bluetap-backend' }),
    /CRITICAL: Staging operations cannot target production Render service/
  );
  assert.throws(
    () => verifyDeployTarget({ env: 'staging', platform: 'render', service: 'bluetap-face-api' }),
    /CRITICAL: Staging operations cannot target production Render service/
  );
  assert.equal(
    verifyDeployTarget({ env: 'staging', platform: 'render', service: 'bluetap-staging-backend' }).safe,
    true
  );

  // Vercel staging rejects production
  assert.throws(
    () => verifyDeployTarget({ env: 'staging', platform: 'vercel', project: 'bluetap-beta' }),
    /CRITICAL: Staging operations cannot target production Vercel project/
  );
  assert.throws(
    () => verifyDeployTarget({ env: 'staging', platform: 'vercel', origin: 'https://bluetap-beta.vercel.app' }),
    /CRITICAL: Staging operations cannot target production Vercel project/
  );
  assert.equal(
    verifyDeployTarget({ env: 'staging', platform: 'vercel', project: 'bluetap-staging-web' }).safe,
    true
  );
});

test('Expo native configuration resolution: verifies Android and iOS manifests resolve cleanly', () => {
  const { getConfig } = require('@expo/config');
  const projectRoot = require('path').resolve(__dirname, '../../../');
  const resolved = getConfig(projectRoot, { isPublicConfig: true });

  assert.equal(resolved.exp.name, 'bluetap');
  assert.equal(resolved.exp.ios.bundleIdentifier, 'com.johnfrank7.bluetap');
  assert.equal(resolved.exp.android.package, 'com.johnfrank7.bluetap');
  assert.ok(resolved.exp.android.permissions.includes('android.permission.CAMERA'));
  assert.ok(resolved.exp.android.permissions.includes('android.permission.ACCESS_FINE_LOCATION'));
  assert.equal(resolved.exp.web.output, 'single');
});
