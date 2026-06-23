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

const SCHEDULED_REQUESTS = [
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

export default function DistributorScheduledRequests() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />

      <View style={styles.phoneWrapper}>
        {/* Top Header - Blue background, white text/icons */}
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

        {/* Main content - Light grey bg, white card */}
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.contentCard}>
            <Text style={styles.pageTitle}>SCHEDULE</Text>
            <Text style={styles.subtitle}>Scheduled Requests</Text>
            <View style={styles.titleDivider} />

            {SCHEDULED_REQUESTS.map((req, index) => (
              <View key={req.id}>
                {index > 0 && <View style={styles.itemDivider} />}
                <View style={styles.requestBlock}>
                  <View style={styles.requestRow}>
                    <Text style={styles.requestId}>Request #{req.id}</Text>
                    <Text style={styles.requestDate}>{req.date}</Text>
                  </View>
                  <Text style={styles.requestDetail}>{req.quantity}</Text>
                  <Text style={styles.requestDetail}>{req.container}</Text>
                  <Text style={styles.requestDetail}>{req.requester}</Text>
                  <Text style={styles.requestDetail}>{req.contact}</Text>
                  <Text style={styles.requestDetail}>{req.address}</Text>
                  <Text style={styles.requestDetail}>Delivery date: {req.deliveryDate}</Text>

                  <View style={styles.deliverDivider} />
                  <TouchableOpacity style={styles.deliverRow}>
                    <Text style={styles.deliverText}>Deliver request</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}

            <View style={{ height: 120 }} />
          </View>
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
    backgroundColor: '#E8E8E8',
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
    paddingBottom: 14,
    backgroundColor: '#187BCD',
  },
  appName: {
    color: '#FFFFFF',
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
    tintColor: '#FFFFFF',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 24,
  },
  contentCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#187BCD',
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: 14,
    color: '#187BCD',
    marginTop: 4,
    marginBottom: 8,
  },
  titleDivider: {
    height: 1,
    backgroundColor: '#90CAF9',
    marginBottom: 16,
  },
  requestBlock: {
    paddingVertical: 12,
  },
  requestRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  requestId: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#187BCD',
  },
  requestDate: {
    fontSize: 14,
    color: '#187BCD',
  },
  requestDetail: {
    fontSize: 14,
    color: '#187BCD',
    marginBottom: 2,
  },
  itemDivider: {
    height: 1,
    backgroundColor: '#90CAF9',
    marginVertical: 8,
  },
  deliverDivider: {
    height: 1,
    backgroundColor: '#90CAF9',
    marginTop: 12,
    marginBottom: 8,
  },
  deliverRow: {
    alignSelf: 'flex-end',
  },
  deliverText: {
    fontSize: 14,
    color: '#187BCD',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  bottomNav: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#187BCD',
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
    tintColor: '#FFFFFF',
  },
});
