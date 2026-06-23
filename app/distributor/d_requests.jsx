import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';

const PENDING_REQUESTS = [
  {
    id: 'BT-01245',
    date: '01/23/26',
    quantity: '3 Gallons',
    container: 'New Container',
    requester: 'Jeanne Ortega',
    contact: '09123456789',
    address: 'Poblacion, Toledo City',
    deliveryDate: 'Jan 25, 2026',
  },
  {
    id: 'BT-01212',
    date: '01/23/26',
    quantity: '2 Gallons',
    container: 'Exchange Container',
    requester: 'Franz Caliguid',
    contact: '09123456789',
    address: 'Tajao, Pinamungajan',
    deliveryDate: 'Jan 25, 2026',
  },
];

export default function DistributorRequests() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />

      <View style={styles.phoneWrapper}>
        {/* Top Header - White */}
        <View style={styles.header}>
          <Text style={styles.appName}>BlueTap</Text>
          <View style={styles.headerIcons}>
            <TouchableOpacity onPress={() => router.replace('/distributor/d_scheduled_requests')}>
              <Image
                source={require('../../assets/icons/calendar-clock.png')}
                style={styles.headerIcon}
              />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.replace('/distributor/d_history')}>
              <Image
                source={require('../../assets/icons/time-past.png')}
                style={styles.headerIcon}
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* Blue content area */}
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.bluePanel}>
            <Text style={styles.pageTitle}>REQUESTS</Text>
            <Text style={styles.subtitle}>Pending Requests</Text>

            {PENDING_REQUESTS.map((req) => (
              <View key={req.id} style={styles.requestCard}>
                <View style={styles.requestCardHeader}>
                  <Text style={styles.requestId}>Request #{req.id}</Text>
                  <Text style={styles.requestDate}>{req.date}</Text>
                </View>
                <Text style={styles.requestDetail}>{req.quantity}</Text>
                <Text style={styles.requestDetail}>{req.container}</Text>
                <Text style={styles.requestDetail}>{req.requester}</Text>
                <Text style={styles.requestDetail}>{req.contact}</Text>
                <Text style={styles.requestDetail}>{req.address}</Text>
                <Text style={styles.requestDetail}>Delivery date: {req.deliveryDate}</Text>

                <View style={styles.requestDivider} />
                <TouchableOpacity style={styles.acceptRow}>
                  <Text style={styles.acceptText}>Accept request</Text>
                </TouchableOpacity>
              </View>
            ))}

            <View style={{ height: 100 }} />
          </View>
        </ScrollView>

        {/* Bottom navigation bar */}
        <View style={styles.bottomNav}>
          <TouchableOpacity onPress={() => router.replace('/distributor/d_dashboard')}>
            <Image source={require('../../assets/icons/home.png')} style={styles.navIcon} />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.replace('/distributor/d_requests')}>
            <Image source={require('../../assets/icons/ballot.png')} style={styles.navIconActive} />
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
    width: '100%',
    maxWidth: 375,
    alignSelf: 'center',
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
  },
  appName: {
    color: '#187BCD',
    fontSize: 22,
    fontWeight: 'bold',
  },
  headerIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIcon: {
    width: 22,
    height: 22,
    tintColor: '#187BCD',
  },
  scrollContent: {
    flexGrow: 1,
  },
  bluePanel: {
    backgroundColor: '#187BCD',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 24,
    minHeight: '100%',
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: 14,
    color: '#FFFFFF',
    marginTop: 4,
    marginBottom: 18,
  },
  requestCard: {
    marginBottom: 20,
  },
  requestCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  requestId: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  requestDate: {
    fontSize: 14,
    color: '#FFFFFF',
  },
  requestDetail: {
    fontSize: 14,
    color: '#FFFFFF',
    marginBottom: 2,
  },
  requestDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.5)',
    marginTop: 12,
    marginBottom: 8,
  },
  acceptRow: {
    alignSelf: 'flex-end',
  },
  acceptText: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '600',
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
  navIconActive: {
    width: 26,
    height: 26,
    tintColor: '#187BCD',
  },
});
