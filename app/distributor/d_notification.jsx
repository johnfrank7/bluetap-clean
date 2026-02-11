import React from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';

export default function DistributorNotification() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />

      <View style={styles.phoneWrapper}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.appName}>BlueTap</Text>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.backIcon}>{'\u2190'}</Text>
          </TouchableOpacity>
        </View>

        {/* Main content - light blue border card */}
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            <Text style={styles.cardTitle}>NOTIFICATION</Text>
            <View style={styles.titleDivider} />

            <View style={styles.cardBody}>
              <Text style={styles.messageText}>
                Request <Text style={styles.boldId}>#BT-01278</Text> has been delivered to Maylene Minoza.
              </Text>

              <View style={styles.divider} />
            </View>
          </View>

          <View style={{ height: 140 }} />
        </ScrollView>

        {/* Bottom navigation bar */}
        <View style={styles.bottomNav}>
          <TouchableOpacity onPress={() => router.replace('/distributor/d_dashboard')}>
            <Image source={require('../../assets/icons/home.png')} style={styles.navIcon} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.replace('/distributor/d_requests')}>
            <Image source={require('../../assets/icons/ballot.png')} style={styles.navIcon} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.replace('/distributor/d_profile')}>
            <Image source={require('../../assets/icons/user.png')} style={styles.navIcon} />
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  phoneWrapper: {
    flex: 1,
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
  appName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#187BCD',
  },
  backIcon: {
    fontSize: 24,
    color: '#187BCD',
    fontWeight: 'bold',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  card: {
    borderWidth: 2,
    borderColor: '#90CAF9',
    borderRadius: 8,
    overflow: 'hidden',
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#187BCD',
    letterSpacing: 1,
    textAlign: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  titleDivider: {
    height: 1,
    backgroundColor: '#90CAF9',
  },
  cardBody: {
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  messageText: {
    fontSize: 14,
    color: '#187BCD',
    lineHeight: 20,
  },
  boldId: {
    fontWeight: 'bold',
    color: '#1565C0',
  },
  divider: {
    height: 1,
    backgroundColor: '#90CAF9',
    marginTop: 14,
  },
  bottomNav: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 22,
    zIndex: 2,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  navIcon: {
    width: 26,
    height: 26,
    tintColor: '#187BCD',
  },
});
