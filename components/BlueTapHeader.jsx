import React, { memo, useCallback } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

const BlueTapHeader = memo(function BlueTapHeader({
  notificationPath,
  rightContent = null,
}) {
  const router = useRouter();

  const openHome = useCallback(() => {
    router.replace('/requester/r_dashboard');
  }, [router]);

  const openNotifications = useCallback(() => {
    if (notificationPath) {
      router.push(notificationPath);
    }
  }, [notificationPath, router]);

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <StatusBar style="light" />

      <View style={styles.frame}>
        <View style={styles.header}>
          <TouchableOpacity
            activeOpacity={0.85}
            hitSlop={8}
            onPress={openHome}
            style={styles.brandButton}
          >
            <Image
              source={require('../assets/icons/bluetapwhitelogo.png')}
              style={styles.brandLogo}
              tintColor="#FFFFFF"
            />
            <Text style={styles.appName}>BlueTap</Text>
          </TouchableOpacity>

          <View style={styles.headerActions}>
            {rightContent}

            <TouchableOpacity
              activeOpacity={0.85}
              hitSlop={8}
              onPress={openNotifications}
            >
              <Image
                source={require('../assets/icons/notif.png')}
                style={styles.notifIcon}
                tintColor="#FFFFFF"
              />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
});

export default BlueTapHeader;

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: '#187BCD',
    zIndex: 30,
  },
  frame: {
    width: '100%',
    maxWidth: 375,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 12,
  },
  brandButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandLogo: {
    width: 24,
    height: 24,
    marginRight: 8,
  },
  appName: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: 'bold',
    letterSpacing: 0,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  notifIcon: {
    width: 22,
    height: 22,
  },
});
