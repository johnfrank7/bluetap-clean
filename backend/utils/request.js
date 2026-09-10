function getClientIp(req, env = process.env) {
  if (env.VERCEL || env.RENDER) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket?.remoteAddress || 'local';
}

module.exports = { getClientIp };
