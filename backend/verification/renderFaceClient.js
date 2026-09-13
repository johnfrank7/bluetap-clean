const { OtpError } = require('../utils/otpError');

function createRenderFaceClient({ env = process.env, fetchImpl = fetch } = {}) {
  return async function request(path, form, signal) {
    const base = (env.DEEPFACE_API_URL || '').replace(/\/+$/, '');
    if (!base.startsWith('https://') || !env.DEEPFACE_API_KEY) throw new OtpError(503, 'face-service-unavailable', 'Face verification is temporarily unavailable.');
    let response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method: form ? 'POST' : 'GET', body: form, signal, redirect: 'error',
        headers: { Authorization: `Bearer ${env.DEEPFACE_API_KEY}` },
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new OtpError(502, 'face-service-network', 'Face verification could not reach its processing service. Please try again later.', { upstreamPath: path });
    }
    const details = { upstreamPath: path, upstreamStatus: response.status };
    if ([401, 403].includes(response.status)) throw new OtpError(502, 'face-service-auth', 'Face verification service authentication failed. Please contact support.', details);
    if (response.status === 404) throw new OtpError(502, 'face-route-unavailable', 'Face verification service requires an update. Please contact support.', details);
    if (response.status === 503) throw new OtpError(503, 'face-service-preparing', 'Face verification service is preparing or busy. Please try again in a moment.', details);
    if ([400, 413, 422].includes(response.status)) throw new OtpError(400, 'invalid-face-image', 'Use a clear image with exactly one visible face.', details);
    if (!response.ok) throw new OtpError(502, 'face-upstream-error', 'Face verification could not finish. Please try again later.', details);
    try { return await response.json(); } catch { throw new OtpError(502, 'invalid-face-response', 'Face verification returned an invalid response.'); }
  };
}
module.exports = { createRenderFaceClient };
