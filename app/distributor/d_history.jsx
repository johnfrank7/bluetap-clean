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

const HISTORY_REQUESTS = [
  {
    id: 'BT-01267',
    date: '01/23/26',
    quantity: '3 Gallons',
    container: 'Exchange Container',
    requester: 'Chane Sarcon',
    contact: '09123456789',
    address: 'Magdugo, Toledo City',
    deliveryDate: 'Jan 25, 2026',
  },
  {
    id: 'BT-01265',
    date: '01/22/26',
    quantity: '2 Gallons',
    container: 'New Container',
    requester: 'Angelyn Paculba',
    contact: '09123456789',
    address: 'Pinamungajan',
    deliveryDate: 'Jan 25, 2026',
  },
];

export default function DistributorHistory() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />

      <View style={styles.phoneWrapper}>
        {/* Top Header - White with shadow */}
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

        {/* Main content - White card with light blue border */}
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.historyCard}>
            <Text style={styles.pageTitle}>HISTORY</Text>
            <Text style={styles.subtitle}>Request History</Text>

            {HISTORY_REQUESTS.map((req, index) => (
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
                </View>
              </View>
            ))}

            <View style={{ height: 100 }} />
          </View>
        </ScrollView>

        {/* Bottom navigation bar */}
        <View style={styles.bottomNav}>
          <TouchableOpacity onPress={() => router.replace('/distributor/d_dashboard')}>
            <Image source={require('../../assets/icons/home.png')} style={styles.navIconActive} />
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
    borderBottomWidth: 0,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
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
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 24,
  },
  historyCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#90CAF9',
    borderRadius: 14,
    padding: 18,
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
    marginBottom: 20,
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
    backgroundColor: '#E0E0E0',
    marginVertical: 4,
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
