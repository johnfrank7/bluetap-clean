// Centralized server-side environment assertions and production isolation guard.
const {
  getAppEnv,
  isKnownProductionFirebaseProject,
  isKnownProductionDeepFaceHost,
  isKnownProductionMailRelay,
  isKnownProductionSupabaseHost,
  APP_ENVIRONMENTS,
} = require('./appEnv');

function checkServerEnvironment(env = process.env) {
  const errors = [];
  let appEnv;

  try {
    appEnv = getAppEnv(env);
  } catch (err) {
    errors.push(err.message);
    return {
      appEnv: null,
      valid: false,
      errors,
    };
  }

  const projectId = String(env.FIREBASE_PROJECT_ID || '').trim();
  const clientEmail = String(env.FIREBASE_CLIENT_EMAIL || '').trim();
  const privateKey = String(env.FIREBASE_PRIVATE_KEY || '').trim();
  const emailProvider = String(env.EMAIL_PROVIDER || '').trim().toLowerCase();
  const relayUrl = String(env.VERCEL_MAIL_RELAY_URL || '').trim();
  const deepFaceUrl = String(env.DEEPFACE_API_URL || '').trim();
  const supabaseUrl = String(env.SUPABASE_URL || '').trim();
  const supabaseKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const supabaseProductBucket = String(env.SUPABASE_STORAGE_BUCKET || '').trim();
  const supabaseDriver = String(env.SUPABASE_STORAGE_DRIVER || '').trim().toLowerCase();

  if (appEnv === APP_ENVIRONMENTS.STAGING) {
    // 1. Firebase Project ID isolation
    if (!projectId) {
      errors.push('FIREBASE_PROJECT_ID is required in staging.');
    } else if (isKnownProductionFirebaseProject(projectId)) {
      errors.push(`Staging backend cannot target production Firebase project "${projectId}".`);
    }

    // 2. Email OTP Relay isolation
    if (emailProvider === 'vercel-relay') {
      if (!relayUrl) {
        errors.push('VERCEL_MAIL_RELAY_URL is required when EMAIL_PROVIDER=vercel-relay in staging.');
      } else if (isKnownProductionMailRelay(relayUrl)) {
        errors.push(`Staging backend cannot target production Vercel mail relay "${relayUrl}".`);
      }
    }

    // 3. DeepFace API isolation
    if (deepFaceUrl && isKnownProductionDeepFaceHost(deepFaceUrl)) {
      errors.push(`Staging backend cannot target production DeepFace API "${deepFaceUrl}".`);
    }

    // 4. Staging credentials requirement and project identity matching
    if (projectId && (!clientEmail || !privateKey)) {
      // If service account path is provided, allow it (for local emulator or custom runner)
      if (!env.FIREBASE_SERVICE_ACCOUNT_PATH && !env.FIRESTORE_EMULATOR_HOST) {
        errors.push('Staging requires explicit FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY.');
      }
    }
    if (clientEmail) {
      if (isKnownProductionFirebaseProject(clientEmail) || clientEmail.toLowerCase().includes('bluetap-8c98d')) {
        errors.push(`Staging backend cannot use production service account "${clientEmail}".`);
      }
      const emailDomainMatch = clientEmail.match(/@([^.]+)\.(?:iam\.gserviceaccount\.com|appspot\.gserviceaccount\.com)$/i);
      if (emailDomainMatch && projectId && emailDomainMatch[1].toLowerCase() !== projectId.toLowerCase()) {
        errors.push(`Service account project "${emailDomainMatch[1]}" does not match FIREBASE_PROJECT_ID "${projectId}".`);
      }
    }

    // 5. Supabase Storage isolation
    if (supabaseDriver === 'mock') {
      // Strict non-network mock is supported for staging
    } else if (supabaseUrl) {
      if (isKnownProductionSupabaseHost(supabaseUrl, env)) {
        errors.push(`Staging backend cannot target production Supabase project "${supabaseUrl}". A dedicated staging Supabase project or mock driver is required.`);
      }
      if (!supabaseKey || !supabaseProductBucket) {
        errors.push('Staging Supabase configuration is inconsistent: SUPABASE_URL is provided, but SUPABASE_SERVICE_ROLE_KEY or SUPABASE_STORAGE_BUCKET is missing.');
      }
    }
  } else if (appEnv === APP_ENVIRONMENTS.PRODUCTION) {
    if (projectId && !isKnownProductionFirebaseProject(projectId)) {
      errors.push(`Production backend must target production Firebase project ("bluetap-8c98d", received "${projectId}").`);
    }
    if (clientEmail && clientEmail.toLowerCase().includes('bluetap-staging')) {
      errors.push(`Production backend cannot use staging service account "${clientEmail}".`);
    }
    if (supabaseDriver === 'mock') {
      errors.push('Staging storage mock is strictly prohibited in production.');
    }
  }

  return {
    appEnv,
    valid: errors.length === 0,
    errors,
  };
}

function validateServerEnvironment(env = process.env) {
  const result = checkServerEnvironment(env);
  if (!result.valid) {
    const error = new Error(`[BlueTap Server Configuration Violation]\n- ${result.errors.join('\n- ')}`);
    error.code = 'CONFIG_SECURITY_VIOLATION';
    error.details = result.errors;
    throw error;
  }
  return result;
}

module.exports = {
  checkServerEnvironment,
  validateServerEnvironment,
};
