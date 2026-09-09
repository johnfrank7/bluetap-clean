const { OtpError } = require('./otpError');

function createRenderFaceClient({ env = process.env, fetchImpl = fetch } = {}) {
  return async function request(path, form, signal) {
    const base = (env.DEEPFACE_API_URL || '').replace(/\/+$/, '');
    if (!base.startsWith('https://') || !env.DEEPFACE_API_KEY) throw new OtpError(503, 'face-service-unavailable', 'Face verification is temporarily unavailable.');
    const response = await fetchImpl(`${base}${path}`, {
      method: form ? 'POST' : 'GET', body: form, signal, redirect: 'error',
      headers: { Authorization: `Bearer ${env.DEEPFACE_API_KEY}` },
    });
    if (response.status === 503) throw new OtpError(503, 'face-service-preparing', 'Face verification service is preparing. Please try again in a moment.');
    if ([400, 413, 422].includes(response.status)) throw new OtpError(400, 'invalid-face-image', 'Use a clear image with exactly one visible face.');
    if (!response.ok) throw new OtpError(502, 'face-upstream-error', 'Face verification could not finish. Please try again later.');
    try { return await response.json(); } catch { throw new OtpError(502, 'invalid-face-response', 'Face verification returned an invalid response.'); }
  };
}
module.exports = { createRenderFaceClient };
