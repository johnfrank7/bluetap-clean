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

export default function DistributorDashboard() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />

      <View style={styles.phoneWrapper}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          

          {/* Header: BlueTap + logo */}
          <View style={styles.header}>
            <Text style={styles.appName}>BlueTap</Text>
            <Image
              source={require('../../assets/icons/bluetaplogo.png')}
              style={styles.logo}
              resizeMode="contain"
            />
          </View>

          {/* Welcome section */}
          <View style={styles.welcomeSection}>
            <Text style={styles.welcomeText}>WELCOME!</Text>
            <Text style={styles.subText}>Current Requests</Text>
          </View>

          {/* Request card - light blue border, white bg */}
          <View style={styles.card}>
            <Text style={styles.cardRequestId}>Request ID BT-01245</Text>
            <Text style={styles.cardText}>Quantity: 3 Gallons</Text>
            <Text style={styles.cardText}>Container: New</Text>
            <Text style={styles.cardText}>Requester: Jeanne Ortega</Text>
            <Text style={styles.cardText}>Contact Num: 09123456789</Text>
            <Text style={styles.cardText}>Poblacion, Toledo City</Text>

            <View style={styles.cardFooter}>
              <Text style={styles.statusText}>Out for delivery</Text>
              <View style={styles.checkCircle}>
                <Text style={styles.checkmark}>✓</Text>
              </View>
            </View>
          </View>

          <View style={{ height: 160 }} />
        </ScrollView>

        {/* Bottom navigation bar */}
        <View style={styles.bottomNav}>
          <TouchableOpacity onPress={() => router.replace('/distributor/d_dashboard')}>
            <Image
              source={require('../../assets/icons/home.png')}
              style={styles.navIcon}
            />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.replace('/distributor/d_requests')}>
            <Image
              source={require('../../assets/icons/ballot.png')}
              style={styles.navIcon}
            />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.replace('/distributor/d_profile')}>
            <Image
              source={require('../../assets/icons/user.png')}
              style={styles.navIcon}
            />
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
  },
  pageLabel: {
    fontSize: 13,
    color: '#9E9E9E',
    marginTop: 8,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  appName: {
    color: '#187BCD',
    fontSize: 22,
    fontWeight: 'bold',
  },
  logo: {
    width: 28,
    height: 28,
  },
  welcomeSection: {
    marginTop: 28,
  },
  welcomeText: {
    color: '#187BCD',
    fontSize: 26,
    fontWeight: 'bold',
  },
  subText: {
    color: '#187BCD',
    fontSize: 14,
    marginTop: 4,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#90CAF9',
    borderRadius: 14,
    padding: 16,
    marginTop: 20,
  },
  cardRequestId: {
    color: '#187BCD',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  cardText: {
    color: '#187BCD',
    fontSize: 14,
    marginBottom: 4,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#E3F2FD',
  },
  statusText: {
    color: '#9E9E9E',
    fontSize: 13,
  },
  checkCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#187BCD',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmark: {
    color: '#FFFFFF',
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
