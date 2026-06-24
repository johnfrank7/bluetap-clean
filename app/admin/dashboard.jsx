import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { auth, db } from '../../firebase';
import { signOut } from 'firebase/auth';
import { collection, doc, onSnapshot, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { getLocalUsers, subscribeLocalUsers, updateLocalUserStatus } from '../../localUsers';

const getRegisteredLocalDistributors = (firestoreDistributors = []) =>
  getLocalUsers()
    .filter(
      (user) =>
        user.role === 'distributor' && user.approvalStatus === 'approved'
    )
    .map((user) => ({ ...user, id: user.uid, isLocal: true }))
    .filter(
      (localUser) =>
        !firestoreDistributors.some(
          (firestoreUser) =>
            firestoreUser.uid === localUser.uid ||
            firestoreUser.email === localUser.email
        )
    );

export default function AdminDashboard() {
  const router = useRouter();
  const [registeredDistributors, setRegisteredDistributors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [removingId, setRemovingId] = useState(null);

  useEffect(() => {
    let firestoreRegistered = [];

    const refreshRegisteredDistributors = (
      nextFirestoreRegistered = firestoreRegistered
    ) => {
      firestoreRegistered = nextFirestoreRegistered;
      setRegisteredDistributors([
        ...firestoreRegistered,
        ...getRegisteredLocalDistributors(firestoreRegistered),
      ]);
      setLoading(false);
    };

    refreshRegisteredDistributors();
    const unsubscribeLocalUsers = subscribeLocalUsers(() =>
      refreshRegisteredDistributors()
    );

    const registeredQuery = query(
      collection(db, 'users'),
      where('role', '==', 'distributor')
    );

    const unsubscribe = onSnapshot(
      registeredQuery,
      (snapshot) => {
        const firestoreDistributors = snapshot.docs
          .map((item) => ({
            id: item.id,
            uid: item.id,
            ...item.data(),
          }))
          .filter((item) => item.approvalStatus === 'approved');

        refreshRegisteredDistributors(firestoreDistributors);
        setLoadError('');
      },
      (error) => {
        console.log('Registered distributors error:', error.message);
        setLoadError(error.message);
        refreshRegisteredDistributors();
      }
    );

    return () => {
      unsubscribe();
      unsubscribeLocalUsers();
    };
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      // ignore errors for secret admin or non-auth sessions
    }
    router.replace('/login');
  };

  const removeDistributor = async (distributor) => {
    const id = distributor.uid || distributor.id;

    try {
      setRemovingId(id);
      updateLocalUserStatus(id, 'rejected');
      setRegisteredDistributors((current) =>
        current.filter((item) => item.uid !== id && item.id !== id)
      );

      try {
        await setDoc(
          doc(db, 'users', id),
          {
            uid: id,
            firstName: distributor.firstName || '',
            lastName: distributor.lastName || '',
            email: distributor.email || '',
            phone: distributor.phone || '',
            address: distributor.address || '',
            role: 'distributor',
            approvalStatus: 'rejected',
            removedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } catch (error) {
        console.log('Distributor Firestore remove error:', error.message);
        Alert.alert(
          'Saved locally',
          'The distributor was removed on this device, but Firestore did not accept the change.'
        );
      }
    } catch (error) {
      console.log('Distributor remove error:', error.message);
      Alert.alert('Remove failed', error.message);
    } finally {
      setRemovingId(null);
    }
  };

  const confirmRemoveDistributor = (distributor, fullName) => {
    if (globalThis.confirm) {
      if (globalThis.confirm(`Remove ${fullName}?`)) {
        removeDistributor(distributor);
      }
      return;
    }

    Alert.alert(
      'Remove distributor',
      `Remove ${fullName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => removeDistributor(distributor),
        },
      ]
    );
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
            style={[styles.navItem, styles.navItemActive]}
            onPress={() => router.replace('/admin/dashboard')}
          >
            <Text style={[styles.navItemText, styles.navItemTextActive]}>Dashboard</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.navItem}
            onPress={() => router.replace('/admin/products')}
          >
            <Text style={styles.navItemText}>Products</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.navItem}
            onPress={() => router.replace('/admin/request')}
          >
            <Text style={styles.navItemText}>Request</Text>
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

          {/* Registered distributors table */}
          <ScrollView contentContainerStyle={styles.cardScroll} showsVerticalScrollIndicator={false}>
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>Registered Distributors</Text>
              </View>

              {/* Table header */}
              <View style={[styles.row, styles.tableHeaderRow]}>
                <Text style={[styles.cell, styles.cellNameHeader]}>Name</Text>
                <Text style={[styles.cell, styles.cellPhoneHeader]}>Contact Number</Text>
                <Text style={[styles.cell, styles.cellEmailHeader]}>Email Address</Text>
                <Text style={[styles.cell, styles.cellActionsHeader]}>Actions</Text>
              </View>

              {loading ? (
                <View style={styles.emptyState}>
                  <ActivityIndicator size="small" color="#187BCD" />
                </View>
              ) : registeredDistributors.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyText}>No registered distributors yet.</Text>
                  {!!loadError && (
                    <Text style={styles.errorText}>Firestore: {loadError}</Text>
                  )}
                </View>
              ) : (
                registeredDistributors.map((d, idx) => {
                  const fullName = `${d.firstName || ''} ${d.lastName || ''}`.trim() || 'Unnamed distributor';
                  const distributorId = d.uid || d.id;
                  const isRemoving = removingId === distributorId;

                  return (
                    <View
                      key={d.id}
                      style={[styles.row, idx % 2 === 1 && styles.rowStriped]}
                    >
                      <Text style={[styles.cell, styles.cellName]}>{fullName}</Text>
                      <Text style={[styles.cell, styles.cellPhone]}>{d.phone || 'Not set'}</Text>
                      <Text style={[styles.cell, styles.cellEmail]}>{d.email || 'Not set'}</Text>
                      <View style={[styles.cell, styles.cellActions]}>
                        <TouchableOpacity
                          style={[styles.removeButton, isRemoving && styles.actionDisabled]}
                          onPress={() => confirmRemoveDistributor(d, fullName)}
                          disabled={isRemoving}
                        >
                          <Text style={styles.removeButtonText}>
                            {isRemoving ? 'Removing...' : 'Remove'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })
              )}
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
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#FFEBEE',
  },
  removeButtonText: {
    color: '#D32F2F',
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
  cellEmailHeader: { flex: 2, fontWeight: 'bold' },
  cellActionsHeader: { flex: 1, fontWeight: 'bold', textAlign: 'right' },
  cellName: { flex: 2 },
  cellPhone: { flex: 1.4 },
  cellEmail: { flex: 2 },
  cellActions: {
    flex: 1,
    alignItems: 'flex-end',
  },
  actionDisabled: {
    opacity: 0.6,
  },
  emptyState: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyText: {
    color: '#757575',
    fontSize: 14,
  },
  errorText: {
    color: '#D32F2F',
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
  },
});
