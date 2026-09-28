function logDevelopmentTiming(channel, details) {
  if (process.env.NODE_ENV === 'development') console.info(channel, details);
}

module.exports = { logDevelopmentTiming };
