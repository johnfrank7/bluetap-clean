const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

// Ensure explicit worktree .env.local EXPO_PUBLIC_* values override stale
// inherited shell environment variables (e.g. production API URLs).
const envLocalPath = path.resolve(__dirname, '.env.local');
if (fs.existsSync(envLocalPath)) {
  const localEnv = dotenv.parse(fs.readFileSync(envLocalPath, 'utf8'));
  for (const [key, value] of Object.entries(localEnv)) {
    if (key.startsWith('EXPO_PUBLIC_')) {
      process.env[key] = value;
    }
  }
}

const config = getDefaultConfig(__dirname);
config.resolver.sourceExts.push('cjs');
config.resolver.unstable_enablePackageExports = false;

// Expo recreates dist during web exports. Metro's Windows fallback watcher can
// otherwise observe that generated asset tree while it is being replaced and
// attempt to lstat a malformed path. Exclude only this project's web output.
const escapeForRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const distPath = escapeForRegExp(path.resolve(__dirname, 'dist'));
const existingBlockList = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(existingBlockList)
    ? existingBlockList
    : existingBlockList
      ? [existingBlockList]
      : []),
  new RegExp(`^${distPath}[\\\\/].*$`),
];

module.exports = withNativeWind(config, { input: './global.css' });
