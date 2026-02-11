import React from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';

export default function RequestFormPage() {
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
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.appName}>BlueTap</Text>

              <View style={styles.headerIcons}>
                <TouchableOpacity onPress={() => router.replace('/requester/r_request')}>
                  <Text style={styles.backIcon}>{'\u2190'}</Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={() => router.replace('/requester/r_notification')}>
                  <Image source={require('../../assets/icons/notif.png')} style={styles.notifIcon} />
                </TouchableOpacity>
              </View>
            </View>

            {/* NEW REQUEST title */}
            <Text style={styles.pageTitle}>NEW REQUEST</Text>

            {/* Requester Information section */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Requester Information</Text>
              <View style={styles.sectionDivider} />

              <Text style={styles.fieldLabel}>Full Name</Text>
              <Text style={styles.fieldLabel}>Contact Number</Text>
              <Text style={styles.fieldLabel}>Address</Text>
            </View>

            {/* Order Details section */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Order Details</Text>
              <View style={styles.sectionDivider} />

              <View style={styles.inlineRow}>
                <Text style={styles.fieldLabel}>Product</Text>
                <Text style={styles.inlineValue}>Mineral Water</Text>
              </View>

              <View style={styles.inlineRow}>
                <Text style={styles.fieldLabel}>Quantity</Text>
                <View style={styles.quantityRow}>
                  <Text style={styles.quantityValue}>0 gallon</Text>
                  <TouchableOpacity style={styles.squareButton}>
                    <Text style={styles.squareButtonText}>+</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.squareButton}>
                    <Text style={styles.squareButtonText}>-</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <Text style={styles.fieldLabel}>Container</Text>
              <TouchableOpacity style={styles.selectorBox}>
                <Text style={styles.selectorText}>New Container</Text>
              </TouchableOpacity>

              <Text style={styles.fieldLabel}>Water Station</Text>
              <TouchableOpacity style={styles.selectorBox}>
                <Text style={styles.selectorText}>Choose station</Text>
              </TouchableOpacity>

              <View style={styles.inlineRow}>
                <Text style={styles.fieldLabel}>Delivery Date</Text>
                <Text style={styles.dateText}>01 - 23 - 2026</Text>
              </View>
              <View style={styles.sectionDivider} />
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Total Cost</Text>
            </View>

            <TouchableOpacity style={styles.submitButton}>
              <Text style={styles.submitText}>Submit request</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelButton}>
              <Text style={styles.cancelText}>Cancel request</Text>
            </TouchableOpacity>
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
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  container: { flex: 1 },
  phoneWrapper: { width: '100%', maxWidth: 375, alignSelf: 'center', flex: 1 },
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
  appName: { color: '#FFFFFF', fontSize: 22, fontWeight: 'bold' },
  headerIcons: { flexDirection: 'row', alignItems: 'center' },
  backIcon: { color: '#FFFFFF', fontSize: 20, marginRight: 10 },
  notifIcon: { width: 22, height: 22, tintColor: '#FFFFFF' },
  pageTitle: {
    marginTop: 32,
    fontSize: 24,
    fontWeight: 'bold',
    letterSpacing: 1,
    color: '#FFFFFF',
  },
  section: { marginTop: 20 },
  sectionTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: 'bold', marginBottom: 10 },
  sectionDivider: {
    height: 1,
    backgroundColor: '#FFFFFF',
    opacity: 0.7,
    marginBottom: 6,
  },
  fieldLabel: { color: '#FFFFFF', fontSize: 13, marginTop: 6 },
  inlineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  inlineValue: { color: '#FFFFFF', fontSize: 13, fontWeight: 'bold' },
  quantityRow: { flexDirection: 'row', alignItems: 'center' },
  quantityValue: { color: '#FFFFFF', fontSize: 13, marginRight: 8 },
  squareButton: {
    width: 26,
    height: 22,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  squareButtonText: { color: '#187BCD', fontSize: 14, fontWeight: 'bold' },
  selectorBox: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#FFFFFF',
    borderRadius: 3,
    height: 28,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  selectorText: { color: '#FFFFFF', fontSize: 13 },
  dateText: { color: '#FFFFFF', fontSize: 13 },
  submitButton: {
    marginTop: 26,
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
  },
  submitText: { color: '#187BCD', fontSize: 15, fontWeight: 'bold' },
  cancelButton: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#FFFFFF',
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
  },
  cancelText: { color: '#FFFFFF', fontSize: 15, fontWeight: 'bold' },
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
  navIcon: { width: 26, height: 26, tintColor: '#187BCD' },
});

