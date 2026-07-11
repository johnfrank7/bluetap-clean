import React, { memo, useCallback } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

const RequesterHeader = memo(function RequesterHeader() {
  const router = useRouter();

  const openDashboard = useCallback(() => {
    router.replace('/requester/r_dashboard');
  }, [router]);

  const openNotifications = useCallback(() => {
    router.replace('/requester/r_notification');
  }, [router]);

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <StatusBar style="light" />

      <View style={styles.frame}>
        <View style={styles.header}>
          <TouchableOpacity
            activeOpacity={0.85}
            hitSlop={8}
            onPress={openDashboard}
            style={styles.brandButton}
          >
            <Image
              source={require('../assets/icons/bluetapwhitelogo.png')}
              style={styles.brandLogo}
            />
            <Text style={styles.appName}>BlueTap</Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.85}
            hitSlop={8}
            onPress={openNotifications}
          >
            <Image
              source={require('../assets/icons/notif.png')}
              style={styles.notifIcon}
            />
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
});

export default RequesterHeader;

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
    tintColor: '#FFFFFF',
    marginRight: 8,
  },
  appName: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: 'bold',
    letterSpacing: 0,
  },
  notifIcon: {
    width: 22,
    height: 22,
    tintColor: '#FFFFFF',
  },
});
