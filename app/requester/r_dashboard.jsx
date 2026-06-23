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
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';

export default function RequesterDashboard() {
  const router = useRouter(); 
  return (
    <LinearGradient
      colors={['#187BCD', '#42A5F5']}
      style={styles.gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
    >
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />

        <View style={styles.phoneWrapper}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >

            <View style={styles.header}>
              <Text style={styles.appName}>BlueTap</Text>
              <Image
                source={require('../../assets/icons/bluetapwhitelogo.png')}
                style={styles.logo}
              />
            </View>

            <View style={styles.welcomeSection}>
              <Text style={styles.welcomeText}>WELCOME!</Text>
              <Text style={styles.subText}>Need mineral water?</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Current Request</Text>

              <Text style={styles.cardText}>Request ID: BT-01302</Text>
              <Text style={styles.cardText}>Quantity: 4 Gallons</Text>
              <Text style={styles.cardText}>Container: Exchange</Text>
              <Text style={styles.cardText}>
                Toledo Pure Water Station
              </Text>

              <Text style={styles.status}>
                Status: Out for delivery
              </Text>
            </View>

            <View style={{ height: 200 }} />

          </ScrollView>

          <View style={styles.bottomNav}>
            <TouchableOpacity onPress={() => router.replace('/requester/r_dashboard')}>
              <Image
                source={require('../../assets/icons/home.png')}
                style={styles.navIcon}
              />
            </TouchableOpacity>

            <TouchableOpacity onPress={() => router.replace('/requester/r_request')}>
              <Image
                source={require('../../assets/icons/square-plus.png')}
                style={styles.navIcon}
              />
            </TouchableOpacity>

            <TouchableOpacity onPress={() => router.replace('/requester/r_profile')}>
              <Image
                source={require('../../assets/icons/user.png')}
                style={styles.navIcon}
              />
            </TouchableOpacity>
          </View>

        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    flex: 1,
    width: '100%',
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
  },
  appName: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: 'bold',
  },
  logo: {
    width: 28,
    height: 28,
    tintColor: '#FFFFFF',
  },
  welcomeSection: {
    marginTop: 40,
  },
  welcomeText: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: 'bold',
  },
  subText: {
    color: '#EAF4FF',
    fontSize: 14,
    marginTop: 4,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginTop: 30,
    elevation: 5,
  },
  cardTitle: {
    color: '#187BCD',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  cardText: {
    color: '#187BCD',
    fontSize: 14,
    marginBottom: 4,
  },
  status: {
    color: '#187BCD',
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 8,
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
  addButton: {
    backgroundColor: '#187BCD',
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addText: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: 'bold',
    marginTop: -2,
  },
});
