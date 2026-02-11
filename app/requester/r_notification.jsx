import React from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';

export default function RequesterNotification() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />

      <View style={styles.phoneWrapper}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.appName}>BlueTap</Text>

          <View style={styles.headerIcons}>
            <TouchableOpacity onPress={() => router.replace('/requester/r_request')}>
              <Text style={styles.backIcon}>{'\u2190'}</Text>
            </TouchableOpacity>

            <Image source={require('../../assets/icons/notif.png')} style={styles.notifIcon} />
          </View>
        </View>

        {/* Main notification card */}
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            {/* Blue title bar */}
            <View style={styles.cardHeader}>
              <Text style={styles.cardHeaderText}>NOTIFICATION</Text>
            </View>

            {/* Notification messages */}
            <View style={styles.cardBody}>
              <Text style={styles.messageText}>
                Your request for <Text style={styles.boldNumber}>#BT-01245</Text> has been sent to
                Toledo Pure Water Station. Please wait for confirmation.
              </Text>

              <View style={styles.divider} />

              <Text style={styles.messageText}>
                Your request <Text style={styles.boldNumber}>#BT-01212</Text> has been approved by
                Toledo Pure Water Station. Delivery will be scheduled soon.
              </Text>

              <View style={styles.divider} />
            </View>
          </View>

          <View style={{ height: 140 }} />
        </ScrollView>

        {/* Bottom navigation bar */}
        <View style={styles.bottomNav}>
          <TouchableOpacity onPress={() => router.replace('/requester/r_dashboard')}>
            <Image source={require('../../assets/icons/home.png')} style={styles.navIcon} />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.replace('/requester/r_request')}>
            <Image source={require('../../assets/icons/square-plus.png')} style={styles.navIcon} />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.replace('/requester/r_profile')}>
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
  },
  appName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#187BCD',
  },
  headerIcons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backIcon: {
    fontSize: 20,
    color: '#187BCD',
    marginRight: 12,
  },
  notifIcon: {
    width: 22,
    height: 22,
    tintColor: '#187BCD',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  card: {
    borderWidth: 2,
    borderColor: '#187BCD',
    borderRadius: 4,
    overflow: 'hidden',
  },
  cardHeader: {
    backgroundColor: '#187BCD',
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  cardHeaderText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  cardBody: {
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  messageText: {
    fontSize: 13,
    color: '#187BCD',
    lineHeight: 18,
    marginBottom: 12,
  },
  boldNumber: {
    fontWeight: 'bold',
  },
  divider: {
    height: 1,
    backgroundColor: '#187BCD',
    opacity: 0.4,
    marginBottom: 14,
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

