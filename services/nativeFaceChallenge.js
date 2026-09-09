// Web resolves this file and never imports a native ML Kit module.
export const nativeChallengeAvailable = () => false;
export async function runNativeFaceChallenge() {
  throw new Error('A browser-compatible liveness detector is still required.');
}
