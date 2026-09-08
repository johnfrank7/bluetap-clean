import React from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BLUETAP_COLORS } from '../constants/bluetapTheme';

const UPDATE_CHECK_INTERVAL_MS = 60 * 1000;
const WEB_ENTRY_PATTERN = /\/_expo\/static\/js\/web\/entry-[^"'\s]+\.js/;

const getLoadedBuildSignature = () => {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return null;

  const script = Array.from(document.scripts || []).find((item) =>
    WEB_ENTRY_PATTERN.test(item.src || '')
  );

  return script?.src?.match(WEB_ENTRY_PATTERN)?.[0] || null;
};

const getDeployedBuildSignature = async () => {
  if (Platform.OS !== 'web') return null;

  const response = await fetch(`/?bluetap-update-check=${Date.now()}`, {
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache' },
  });

  if (!response.ok) return null;

  const html = await response.text();
  return html.match(WEB_ENTRY_PATTERN)?.[0] || null;
};

/**
 * Web-only update notice. Expo's export creates a new hashed entry script for
 * each deployment, so comparing that script does not require an update server.
 */
export default function WebUpdateBanner() {
  const insets = useSafeAreaInsets();
  const [isUpdateAvailable, setIsUpdateAvailable] = React.useState(false);

  React.useEffect(() => {
    if (Platform.OS !== 'web') return undefined;

    let isActive = true;
    const loadedSignature = getLoadedBuildSignature();

    if (!loadedSignature) return undefined;

    const checkForUpdate = async () => {
      try {
        const deployedSignature = await getDeployedBuildSignature();

        if (
          isActive &&
          deployedSignature &&
          deployedSignature !== loadedSignature
        ) {
          setIsUpdateAvailable(true);
        }
      } catch (error) {
        // Update checks are best-effort and must never interrupt the app.
        console.log('Web update check failed:', error.message);
      }
    };

    const initialCheckTimeout = setTimeout(checkForUpdate, 5000);
    const intervalId = setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);

    return () => {
      isActive = false;
      clearTimeout(initialCheckTimeout);
      clearInterval(intervalId);
    };
  }, []);

  const reloadPage = () => {
    if (Platform.OS === 'web') {
      globalThis.location?.reload();
    }
  };

  if (!isUpdateAvailable || Platform.OS !== 'web') return null;

  return (
    <View style={[styles.banner, { paddingTop: Math.max(insets.top, 10) }]}>
      <View style={styles.content}>
        <Text style={styles.message}>A new version of BlueTap is available.</Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Reload BlueTap to update"
          activeOpacity={0.8}
          onPress={reloadPage}
          style={styles.reloadButton}
        >
          <Text style={styles.reloadText}>Reload</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BLUETAP_COLORS.primaryDark,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.22)',
    paddingHorizontal: 18,
    paddingBottom: 10,
    shadowColor: '#063A67',
    shadowOpacity: 0.28,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 10,
  },
  content: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: {
    color: BLUETAP_COLORS.white,
    fontSize: 14,
    fontWeight: '700',
    marginRight: 12,
  },
  reloadButton: {
    minWidth: 88,
    backgroundColor: BLUETAP_COLORS.primaryDeep,
    borderWidth: 2,
    borderColor: BLUETAP_COLORS.white,
    borderRadius: 16,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    shadowColor: BLUETAP_COLORS.primaryDeep,
    shadowOpacity: 0.28,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  reloadText: {
    color: BLUETAP_COLORS.white,
    fontSize: 13,
    fontWeight: '800',
  },
});
