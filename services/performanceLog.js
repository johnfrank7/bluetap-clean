const developmentTimingEnabled = () =>
  (typeof __DEV__ !== 'undefined' && __DEV__ === true) ||
  globalThis?.process?.env?.NODE_ENV === 'development';

export function logDevelopmentTiming(channel, details) {
  if (developmentTimingEnabled()) console.info(channel, details);
}
