import React from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { auth } from '../../firebase';
import { signOut } from 'firebase/auth';

const PENDING_DISTRIBUTORS = [
  { name: 'Gabrielle Flores', phone: '09123456789' },
  { name: 'Rose Baricuatro', phone: '09123456788' },
  { name: 'Junard Remeticado', phone: '09123456787' },
  { name: 'Luo Hiyan', phone: '09123456778' },
];

export default function AdminRequestPage() {
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      // ignore if secret admin not in Firebase session
    }
    router.replace('/login');
  };

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      <View style={styles.container}>
        {/* Sidebar */}
        <View style={styles.sidebar}>
          <View style={styles.stationHeader}>
            <Image
              source={require('../../assets/icons/bluetaplogo.png')}
              style={styles.logoImage}
              resizeMode="contain"
            />
            <Text style={styles.stationName}>Station Name</Text>
          </View>

          <TouchableOpacity
            style={styles.navItem}
            onPress={() => router.replace('/admin/dashboard')}
          >
            <Text style={styles.navItemText}>Dashboard</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.navItem, styles.navItemActive]}
            onPress={() => router.replace('/admin/request')}
          >
            <Text style={[styles.navItemText, styles.navItemTextActive]}>Request</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.navItem}>
            <Text style={styles.navItemText}>Profile</Text>
          </TouchableOpacity>

          <View style={styles.sidebarFooter}>
            <Text style={styles.footerBrand}>BlueTap</Text>
          </View>
        </View>

        {/* Main content */}
        <View style={styles.main}>
          {/* Top bar */}
          <View style={styles.topBar}>
            <View style={styles.searchContainer}>
              <TextInput
                style={styles.searchInput}
                placeholder="Search"
                placeholderTextColor="#B0BEC5"
              />
              <TouchableOpacity style={styles.searchButton}>
                <Text style={styles.searchIcon}>🔍</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
              <Text style={styles.logoutText}>LOGOUT</Text>
            </TouchableOpacity>
          </View>

          {/* Pending distributors table */}
          <ScrollView contentContainerStyle={styles.cardScroll} showsVerticalScrollIndicator={false}>
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>Pending Distributors</Text>
                <TouchableOpacity style={styles.removeButton}>
                  <Text style={styles.removeButtonText}>Remove</Text>
                </TouchableOpacity>
              </View>

              {/* Table header */}
              <View style={[styles.row, styles.tableHeaderRow]}>
                <Text style={[styles.cell, styles.cellNameHeader]}>Name</Text>
                <Text style={[styles.cell, styles.cellPhoneHeader]}>Contact Number</Text>
                <Text style={[styles.cell, styles.cellActionsHeader]}>Actions</Text>
              </View>

              {/* Table rows */}
              {PENDING_DISTRIBUTORS.map((d, idx) => (
                <View
                  key={d.name + d.phone}
                  style={[styles.row, idx % 2 === 1 && styles.rowStriped]}
                >
                  <Text style={[styles.cell, styles.cellName]}>{d.name}</Text>
                  <Text style={[styles.cell, styles.cellPhone]}>{d.phone}</Text>
                  <View style={[styles.cell, styles.cellActions]}>
                    <TouchableOpacity style={styles.rejectButton}>
                      <Text style={styles.rejectText}>Reject</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.acceptButton}>
                      <Text style={styles.acceptText}>Accept</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F2F4F7',
  },
  container: {
    flex: 1,
    flexDirection: 'row',
  },

  /* Sidebar */
  sidebar: {
    width: 260,
    backgroundColor: '#187BCD',
    paddingTop: 24,
    paddingHorizontal: 20,
  },
  stationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 32,
  },
  logoImage: {
    width: 32,
    height: 32,
    marginRight: 10,
  },
  stationName: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },

  navItem: {
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 4,
    marginBottom: 6,
  },
  navItemActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  navItemText: {
    color: '#E3F2FD',
    fontSize: 14,
  },
  navItemTextActive: {
    fontWeight: 'bold',
  },

  sidebarFooter: {
    marginTop: 'auto',
    paddingVertical: 16,
  },
  footerBrand: {
    color: '#FFFFFF',
    fontSize: 14,
  },

  /* Main area */
  main: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 20,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  searchInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 14,
    color: '#455A64',
  },
  searchButton: {
    width: 44,
    height: '100%',
    backgroundColor: '#187BCD',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchIcon: {
    color: '#FFFFFF',
    fontSize: 18,
  },

  logoutButton: {
    marginLeft: 16,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#187BCD',
    backgroundColor: '#FFFFFF',
  },
  logoutText: {
    color: '#187BCD',
    fontWeight: '600',
    fontSize: 13,
  },

  cardScroll: {
    paddingBottom: 24,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 20,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTitle: {
    color: '#187BCD',
    fontSize: 16,
    fontWeight: 'bold',
  },
  removeButton: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: '#E3F2FD',
  },
  removeButtonText: {
    color: '#187BCD',
    fontSize: 13,
    fontWeight: '600',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F1F1',
  },
  tableHeaderRow: {
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  rowStriped: {
    backgroundColor: '#FAFAFA',
  },
  cell: {
    fontSize: 14,
    color: '#455A64',
  },
  cellNameHeader: { flex: 2, fontWeight: 'bold' },
  cellPhoneHeader: { flex: 1.4, fontWeight: 'bold' },
  cellActionsHeader: { flex: 1.8, fontWeight: 'bold' },
  cellName: { flex: 2 },
  cellPhone: { flex: 1.4 },
  cellActions: {
    flex: 1.8,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  rejectButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#EEEEEE',
    marginRight: 8,
  },
  rejectText: {
    color: '#757575',
    fontSize: 13,
  },
  acceptButton: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#187BCD',
  },
  acceptText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
});

