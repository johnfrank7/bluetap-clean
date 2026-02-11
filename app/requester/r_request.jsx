import React from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';

export default function RequesterRequests() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />

      <View style={styles.phoneWrapper}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.appName}>BlueTap</Text>
            <TouchableOpacity onPress={() => router.replace('/requester/r_notification')}>
              <Image source={require('../../assets/icons/notif.png')} style={styles.logo} />
            </TouchableOpacity>
          </View>

          {/* Blue requests panel */}
          <View style={styles.requestsPanel}>
            <Text style={styles.pageTitle}>REQUESTS</Text>

            <View style={styles.historyHeader}>
              <Text style={styles.historyTitle}>Request History</Text>
              <View style={styles.historyDivider} />
            </View>

            <View style={styles.requestCard}>
              <Text style={styles.requestId}>Request #BT-01245</Text>
              <Text style={styles.requestMeta}>Jan 23, 2026</Text>
              <Text style={styles.requestMeta}>3 Gallons</Text>
              <Text style={styles.requestMeta}>Exchange container</Text>
              <Text style={styles.requestMeta}>Toledo Pure Water Station</Text>

              <View style={styles.requestFooterRow}>
                <View style={styles.requestUnderline} />
                <TouchableOpacity style={styles.detailsButton}>
                  <Text style={styles.detailsText}>View Details</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={styles.addRequestButton}
                onPress={() => router.replace('/requester/requestform')}
              >
                <Text style={styles.addRequestText}>Add request</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={{ height: 140 }} />
        </ScrollView>

        {/* Bottom navigation bar */}
        <View style={styles.bottomNav}>
          <TouchableOpacity onPress={() => router.replace('/requester/r_dashboard')}>
            <Image source={require('../../assets/icons/home.png')} style={styles.navIcon} />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.replace('/requester/requestform')}>
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
    width: '100%',
    maxWidth: 375,
    alignSelf: 'center',
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 140,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  appName: {
    color: '#187BCD',
    fontSize: 22,
    fontWeight: 'bold',
  },
  logo: {
    width: 24,
    height: 24,
    tintColor: '#187BCD',
  },
  requestsPanel: {
    marginTop: 28,
    backgroundColor: '#187BCD',
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 24,
  },
  pageTitle: {
    marginTop: 0,
    fontSize: 24,
    fontWeight: 'bold',
    letterSpacing: 1,
    color: '#FFFFFF',
  },
  historyHeader: {
    marginTop: 18,
  },
  historyTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#EAF4FF',
    marginBottom: 6,
  },
  historyDivider: {
    height: 1,
    backgroundColor: '#EAF4FF',
    opacity: 0.6,
  },
  requestCard: {
    marginTop: 18,
  },
  requestId: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  requestMeta: {
    color: '#EAF4FF',
    fontSize: 14,
    marginBottom: 2,
  },
  requestFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
  },
  requestUnderline: {
    flex: 1,
    height: 1,
    backgroundColor: '#EAF4FF',
    opacity: 0.7,
  },
  detailsButton: {
    marginLeft: 8,
  },
  detailsText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  addRequestButton: {
    marginTop: 28,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addRequestText: {
    color: '#187BCD',
    fontSize: 16,
    fontWeight: 'bold',
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

