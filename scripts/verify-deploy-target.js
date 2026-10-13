#!/usr/bin/env node
// CLI safety helper: verifies Firebase/Render deployment targets before execution.
const {
  isKnownProductionFirebaseProject,
  isKnownProductionBackendHost,
  isKnownProductionDeepFaceHost,
  isKnownProductionVercelOrigin,
} = require('../backend/config/appEnv');

function parseArgs(args = process.argv.slice(2)) {
  const result = {};
  for (const arg of args) {
    if (arg.startsWith('--env=')) result.env = arg.slice(6).trim().toLowerCase();
    if (arg.startsWith('--platform=')) result.platform = arg.slice(11).trim().toLowerCase();
    if (arg.startsWith('--project=')) result.project = arg.slice(10).trim();
    if (arg.startsWith('--service=')) result.service = arg.slice(10).trim();
    if (arg.startsWith('--origin=')) result.origin = arg.slice(9).trim();
  }
  return result;
}

function verifyDeployTarget({ env, platform = 'firebase', project, service, origin }) {
  if (!env) {
    throw new Error('Target environment is required (--env=staging|production).');
  }

  const validPlatforms = new Set(['firebase', 'render', 'vercel']);
  if (!validPlatforms.has(platform)) {
    throw new Error(`Unsupported platform "${platform}". Use firebase, render, or vercel.`);
  }

  if (env === 'staging') {
    if (platform === 'firebase') {
      if (!project) {
        throw new Error('Explicit project ID is required for staging deployment (--project=<staging-project-id>).');
      }
      if (isKnownProductionFirebaseProject(project)) {
        throw new Error(`CRITICAL: Staging operations cannot target production Firebase project "${project}".`);
      }
      return { ok: true, env, platform, project, target: project, safe: true };
    }

    if (platform === 'render') {
      if (!service) {
        throw new Error('Explicit service name is required for staging Render deployment (--service=<staging-service-name>).');
      }
      const prodServices = new Set(['bluetap-clean', 'bluetap-backend', 'bluetap-face-api']);
      if (prodServices.has(service.toLowerCase()) || isKnownProductionBackendHost(service) || isKnownProductionDeepFaceHost(service)) {
        throw new Error(`CRITICAL: Staging operations cannot target production Render service "${service}".`);
      }
      return { ok: true, env, platform, target: service, safe: true };
    }

    if (platform === 'vercel') {
      const target = project || origin;
      if (!target) {
        throw new Error('Explicit project or origin is required for staging Vercel deployment (--project=<staging-project>).');
      }
      if (target.toLowerCase() === 'bluetap-beta' || isKnownProductionVercelOrigin(target)) {
        throw new Error(`CRITICAL: Staging operations cannot target production Vercel project/origin "${target}".`);
      }
      return { ok: true, env, platform, target, safe: true };
    }
  }

  if (env === 'production') {
    if (platform === 'firebase') {
      if (!project) {
        throw new Error('Explicit project ID is required for production deployment (--project=bluetap-8c98d).');
      }
      if (!isKnownProductionFirebaseProject(project)) {
        throw new Error(`CRITICAL: Production deployment requires project "bluetap-8c98d" (received "${project}").`);
      }
      return { ok: true, env, platform, project, target: project, safe: true };
    }

    if (platform === 'render') {
      if (!service) {
        throw new Error('Explicit service name is required for production Render deployment (--service=<service-name>).');
      }
      return { ok: true, env, platform, target: service, safe: true };
    }

    if (platform === 'vercel') {
      const target = project || origin;
      if (!target) {
        throw new Error('Explicit project or origin is required for production Vercel deployment (--project=<project>).');
      }
      return { ok: true, env, platform, target, safe: true };
    }
  }

  throw new Error(`Unrecognized environment "${env}". Use staging or production.`);
}

if (require.main === module) {
  try {
    const parsed = parseArgs();
    const verified = verifyDeployTarget(parsed);
    console.log(`[BlueTap Target Verification] Verified safe ${verified.platform} target for ${verified.env}: ${verified.target}`);
    process.exit(0);
  } catch (error) {
    console.error(`[BlueTap Target Verification ERROR] ${error.message}`);
    process.exit(1);
  }
}

module.exports = { parseArgs, verifyDeployTarget };
